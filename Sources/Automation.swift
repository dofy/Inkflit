import Cocoa
import Darwin

private let automationLimit = 8 * 1024 * 1024

private enum AutomationSocket {
    static var path: String {
        if let override = ProcessInfo.processInfo.environment["INKFLIT_SOCKET_PATH"], !override.isEmpty { return override }
        return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Inkflit/Automation/bridge.sock").path
    }
    static func address(_ path: String) throws -> sockaddr_un {
        guard path.utf8.count < MemoryLayout.size(ofValue: sockaddr_un().sun_path) else { throw Failure("Socket path is too long") }
        var address = sockaddr_un(); address.sun_family = sa_family_t(AF_UNIX); address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
        let pathBytes = Array(path.utf8)
        withUnsafeMutableBytes(of: &address.sun_path) { bytes in bytes.copyBytes(from: pathBytes) }
        return address
    }
    static func connect(_ path: String) -> Int32 {
        let fd = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { return -1 }
        guard var address = try? address(path) else { Darwin.close(fd); return -1 }
        let result = withUnsafePointer(to: &address) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) } }
        if result != 0 { Darwin.close(fd); return -1 }
        var yes: Int32 = 1; setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &yes, socklen_t(MemoryLayout<Int32>.size))
        return fd
    }
    static func send(_ object: [String: Any], to fd: Int32) throws {
        let data = try JSONSerialization.data(withJSONObject: object) + Data([10])
        guard data.count <= automationLimit else { throw Failure("Request or response is too large") }
        try data.withUnsafeBytes { bytes in
            var position = 0
            while position < bytes.count {
                let written = Darwin.write(fd, bytes.baseAddress!.advanced(by: position), bytes.count - position)
                if written <= 0 { throw Failure("Connection closed") }; position += written
            }
        }
    }
    static func receive(_ fd: Int32) throws -> [String: Any] {
        var data = Data(), buffer = [UInt8](repeating: 0, count: 8192)
        while data.count <= automationLimit {
            let count = Darwin.read(fd, &buffer, buffer.count)
            guard count > 0 else {
                if count < 0 && (errno == EAGAIN || errno == EWOULDBLOCK) { throw Failure("Timed out; the operation may still complete. Check the note before retrying.") }
                throw Failure("Connection closed")
            }
            if let newline = buffer[..<count].firstIndex(of: 10) {
                data.append(contentsOf: buffer[..<newline]); break
            }
            data.append(contentsOf: buffer[..<count])
        }
        guard data.count <= automationLimit, let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw Failure("Invalid request") }
        return object
    }
}
struct Failure: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

final class AutomationServer {
    /// Read by the background accept loop and written by start/stop, so guarded by a lock.
    private var listener: Int32 = -1
    private let lock = NSLock()
    private func isListening(_ fd: Int32) -> Bool { lock.lock(); defer { lock.unlock() }; return listener == fd }
    private let path: String
    private let handler: ([String: Any], @escaping ([String: Any]) -> Void) -> Void
    init(handler: @escaping ([String: Any], @escaping ([String: Any]) -> Void) -> Void) { self.path = AutomationSocket.path; self.handler = handler }
    func start() throws {
        let dir=URL(fileURLWithPath:path).deletingLastPathComponent()
        if !FileManager.default.fileExists(atPath:dir.path) { try FileManager.default.createDirectory(at:dir,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700]) }
        var existing=stat()
        if lstat(path,&existing)==0 {
            let active=AutomationSocket.connect(path)
            if active >= 0 { Darwin.close(active); throw Failure("Inkflit automation is already running") }
            guard (existing.st_mode & S_IFMT)==S_IFSOCK, existing.st_uid==getuid() else { throw Failure("Automation socket path is occupied") }
            guard unlink(path)==0 else { throw Failure("Could not remove stale socket") }
        }
        let socketFD=Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard socketFD >= 0 else { throw Failure("Could not create automation socket") }
        var address: sockaddr_un
        do { address=try AutomationSocket.address(path) } catch { Darwin.close(socketFD); throw error }
        let result=withUnsafePointer(to:&address) { $0.withMemoryRebound(to:sockaddr.self,capacity:1) { Darwin.bind(socketFD,$0,socklen_t(MemoryLayout<sockaddr_un>.size)) } }
        guard result==0 else { Darwin.close(socketFD);throw Failure("Could not bind automation socket") }
        guard chmod(path,0o600)==0, Darwin.listen(socketFD,16)==0 else { Darwin.close(socketFD);unlink(path);throw Failure("Could not start automation socket") }
        lock.lock(); listener=socketFD; lock.unlock()
        DispatchQueue.global(qos:.utility).async { [weak self] in
            while let self, self.isListening(socketFD) {
                let client=Darwin.accept(socketFD,nil,nil)
                if client<0 { break }
                DispatchQueue.global(qos:.utility).async { self.accept(client) }
            }
        }
    }
    private func accept(_ fd: Int32) {
        var uid: uid_t=0, gid: gid_t=0
        guard getpeereid(fd,&uid,&gid)==0, uid==getuid() else { Darwin.close(fd); return }
        var yes:Int32=1; setsockopt(fd,SOL_SOCKET,SO_NOSIGPIPE,&yes,socklen_t(MemoryLayout<Int32>.size))
        var timeout=timeval(tv_sec:10,tv_usec:0);setsockopt(fd,SOL_SOCKET,SO_RCVTIMEO,&timeout,socklen_t(MemoryLayout<timeval>.size))
        do {
            let request=try AutomationSocket.receive(fd)
            DispatchQueue.main.async { [handler] in
                handler(request) { reply in
                    DispatchQueue.global(qos:.utility).async {
                        do { try AutomationSocket.send(reply,to:fd) }
                        catch { try? AutomationSocket.send(["error":error.localizedDescription],to:fd) }
                        Darwin.close(fd)
                    }
                }
            }
        } catch { try? AutomationSocket.send(["error":error.localizedDescription],to:fd);Darwin.close(fd) }
    }
    func stop() {
        lock.lock(); let fd=listener; listener = -1; lock.unlock()
        guard fd >= 0 else { return }
        Darwin.shutdown(fd,SHUT_RDWR);Darwin.close(fd)
        unlink(path)
    }
}

enum AutomationUILink: Equatable {
    case noteID(String), noteIndex(Int), appearance, snippets, invalid

    static func parse(_ components: URLComponents) -> Self? {
        let host = components.host?.lowercased()
        let path = components.path.split(separator: "/").map { $0.lowercased() }
        let items = components.queryItems ?? []
        if host == "settings" {
            guard items.isEmpty else { return .invalid }
            if path == ["appearance"] { return .appearance }
            if path == ["snippets"] { return .snippets }
            return .invalid
        }
        guard host == "note" || host == "notes", path == ["open"] else { return nil }
        guard items.count == 1, let item = items.first, let value = item.value, !value.isEmpty else { return .invalid }
        switch item.name {
        case "id": return .noteID(value)
        case "index":
            guard let index = Int(value), index > 0 else { return .invalid }
            return .noteIndex(index)
        default: return .invalid
        }
    }
}

enum InkflitMCP {
    private struct Tool {
        let name: String
        let action: String
        let descriptor: [String: Any]
    }
    private static let tools: [Tool] = {
        let content:[String:Any] = ["type":"string","description":"Markdown text; append inserts a newline if needed"]
        let target:[String:Any] = ["index":["type":"integer","minimum":1,"description":"1-based note number as displayed in Inkflit"],"id":["type":"string","description":"Stable note ID; use instead of index"]]
        let formatTarget: [String: Any] = ["id": ["type":"string", "minLength":1, "description":"Stable ID of the note to format."]]
        var formatApply = formatTarget
        formatApply["preview_id"] = ["type":"string", "minLength":1, "description":"The ID returned by preview_note_format for this same note."]
        func tool(_ name:String,_ action:String,_ description:String,_ properties:[String:Any],_ required:[String]=[]) -> Tool {
            Tool(name: name, action: action, descriptor: [
                "name":name,"description":description,"inputSchema":["type":"object","properties":properties,"required":required,"additionalProperties":false]
            ])
        }
        var write=target;write["content"]=content
        let pagination: [String: Any] = [
            "limit": ["type":"integer", "minimum":1, "maximum":100, "description":"Page size. Defaults to 50 when any list option is provided."],
            "cursor": ["type":"string", "minLength":1, "description":"Pass next_cursor from the previous page."],
            "include_content": ["type":"boolean", "description":"Set false to return a short first-line summary and metadata without the full text. Repeat on subsequent pages."]
        ]
        return [tool("list_notes","list","List notes in displayed order. Use list options for pagination and summaries. With no options, returns all notes with full content.",pagination),
                tool("search_notes","search","Search all current notes.",["query":["type":"string"]],["query"]),
                tool("get_note","get","Read a note by its 1-based index or ID.",target),
                tool("get_current_note","current","Read the note currently selected in Inkflit, including its stable ID.",[:]),
                tool("analyze_note","analyze","Analyze math, sum, average, count, and checklist blocks in a note. Returns structured results without editing the note. Provide either id or index.",target),
                tool("preview_note_format","format-preview","Preview a unified diff for formatting existing supported code blocks and math expressions in the specified note. Returns preview_id for apply_note_format when there are changes.",formatTarget,["id"]),
                tool("apply_note_format","format-apply","Apply a previously previewed diff to the same note by id. Fails if the note content changed since the preview.",formatApply,["id","preview_id"]),
                tool("create_note","create","Create a new note at the end (default), beginning, or a 1-based position.",["content":content,"position":["description":"first, last, or 1-based insertion position (up to note count + 1)","anyOf":[["type":"string","enum":["first","last"]],["type":"integer","minimum":1]]]], ["content"]),
                tool("append_note","append","Append to a note by index or ID; omit both to create a new note.",write,["content"]),
                tool("replace_note","replace","Replace a note's contents; omit index and ID to create a new note.",write,["content"]),
                tool("delete_note","delete","Delete a note by index or ID; the previous content goes to Trash.",target)]
    }()
    static func run() {
        while let line=readLine() {
            guard let data=line.data(using:.utf8), let request=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any] else { emit(["jsonrpc":"2.0","id":NSNull(),"error":["code":-32700,"message":"Parse error"]]); continue }
            guard let method=request["method"] as? String else { continue }
            guard let id=request["id"] else { continue }
            func result(_ value:Any) { emit(["jsonrpc":"2.0","id":id,"result":value]) }
            switch method {
            case "initialize":
                let params=request["params"] as? [String:Any], requested=params?["protocolVersion"] as? String ?? "2025-11-25"
                let supported=["2025-11-25","2025-06-18","2025-03-26","2024-11-05"]
                result(["protocolVersion":supported.contains(requested) ? requested : "2025-11-25","capabilities":["tools":[:]],"serverInfo":["name":"inkflit","version":(Bundle.main.object(forInfoDictionaryKey:"CFBundleShortVersionString") as? String ?? "unknown")]])
            case "ping":result([:])
            case "tools/list":result(["tools":tools.map(\.descriptor)])
            case "tools/call":
                let params=request["params"] as? [String:Any] ?? [:], name=params["name"] as? String ?? ""
                guard let tool = tools.first(where: { $0.name == name }) else { result(["content":[["type":"text","text":"Unknown tool"]],"isError":true]);continue }
                var operation=params["arguments"] as? [String:Any] ?? [:];operation["action"]=tool.action
                do {
                    let reply=try requestApp(operation)
                    let text=String(data:try JSONSerialization.data(withJSONObject:reply,options:[.sortedKeys]),encoding:.utf8) ?? "{}"
                    result(["content":[["type":"text","text":text]],"isError":reply["error"] != nil])
                } catch { result(["content":[["type":"text","text":error.localizedDescription]],"isError":true]) }
            default:emit(["jsonrpc":"2.0","id":id,"error":["code":-32601,"message":"Method not found"]])
            }
        }
    }
    private static func emit(_ object:[String:Any]) {
        guard let data=try? JSONSerialization.data(withJSONObject:object),let text=String(data:data,encoding:.utf8) else { return }
        print(text);fflush(stdout)
    }
    private static func requestApp(_ operation:[String:Any]) throws -> [String:Any] {
        var fd=AutomationSocket.connect(AutomationSocket.path)
        if fd < 0 && ProcessInfo.processInfo.environment["INKFLIT_SOCKET_PATH"] == nil {
            let process=Process();process.executableURL=URL(fileURLWithPath:"/usr/bin/open");process.arguments=["-a",Bundle.main.bundleURL.path]
            process.standardOutput=FileHandle.nullDevice;process.standardError=FileHandle.nullDevice
            try process.run();process.waitUntilExit()
            guard process.terminationStatus == 0 else { throw Failure("Could not start Inkflit") }
            for _ in 0..<120 { usleep(100_000);fd=AutomationSocket.connect(AutomationSocket.path);if fd>=0 { break } }
        }
        guard fd >= 0 else { throw Failure("Inkflit is not available") }
        defer { Darwin.close(fd) }
        var timeout=timeval(tv_sec:30,tv_usec:0);setsockopt(fd,SOL_SOCKET,SO_RCVTIMEO,&timeout,socklen_t(MemoryLayout<timeval>.size))
        try AutomationSocket.send(operation,to:fd)
        return try AutomationSocket.receive(fd)
    }
}
