import AppKit
import WebKit
import ApplicationServices

// Compiled only by scripts/test-native.sh. Drives the real app's NSWindow and
// WKWebView with AppKit keyboard events while using an isolated data file.
final class NativeCodeEditingTest {
    private let app: AppDelegate
    private let unit: String
    private var completedText = ""
    private var streamStartedAt: TimeInterval = 0
    private static var running: NativeCodeEditingTest?
    private static var backdropWindow: NSWindow?

    static func installBackdrop(_ app: AppDelegate) {
        final class Pattern: NSView {
            override func draw(_ dirtyRect: NSRect) {
                NSColor.systemBlue.setFill(); bounds.fill()
                NSColor.systemRed.setFill()
                for x in stride(from: CGFloat(0), through: bounds.width, by: 120) { NSRect(x: x, y: 0, width: 60, height: bounds.height).fill() }
            }
        }
        let window = NSWindow(contentRect: app.window.frame, styleMask: .borderless, backing: .buffered, defer: false)
        window.contentView = Pattern(frame: NSRect(origin: .zero, size: app.window.frame.size)); window.isReleasedWhenClosed = false
        window.orderFront(nil); app.window.makeKeyAndOrderFront(nil); backdropWindow = window
        if let path = ProcessInfo.processInfo.environment["INKFLIT_TEST_CAPTURE"] {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                guard app.window.isVisible,
                      let windows = CGWindowListCopyWindowInfo(.optionIncludingWindow, CGWindowID(app.window.windowNumber)) as? [[String: Any]],
                      let bounds = windows.first?[kCGWindowBounds as String] as? [String: NSNumber],
                      let x = bounds["X"], let y = bounds["Y"], let width = bounds["Width"], let height = bounds["Height"] else { fputs("FAIL: could not locate backdrop fixture\n", stderr); exit(1) }
                let process = Process(); process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
                process.arguments = ["-x", "-R\(x.intValue),\(y.intValue),\(width.intValue),\(height.intValue)", path]
                do { try process.run(); process.waitUntilExit(); if process.terminationStatus != 0 { throw NSError(domain: "Screenshot", code: Int(process.terminationStatus)) }; print("Saved fixture screenshot \(path)") }
                catch { fputs("FAIL: fixture screenshot could not be saved\n", stderr); exit(1) }
                app.restoreInputSource(); exit(0)
            }
        }
    }

    init(_ app: AppDelegate) {
        self.app = app
        switch app.codeIndentation() { case "spaces4": unit = "    "; case "tabs": unit = "\t"; default: unit = "  " }
    }
    static func start(_ app: AppDelegate) {
        running = NativeCodeEditingTest(app)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { running?.run() }
    }
    static func startAutomationEdit(_ app: AppDelegate) {
        running=NativeCodeEditingTest(app);app.showWindow()
        DispatchQueue.main.asyncAfter(deadline:.now()+0.6) { running?.testAutomationEdit() }
    }
    private func testAutomationEdit() {
        sequence([{ self.key(34,"i") }, { self.key(7,"x") }, { self.key(53,"\u{1b}") }]) { [self] in
            guard let path=ProcessInfo.processInfo.environment["INKFLIT_EDIT_READY_PATH"] else { fail("missing test ready path") }
            do { try "ready".write(toFile:path,atomically:true,encoding:.utf8) } catch { fail("could not signal editing") }
            if let hiddenPath=ProcessInfo.processInfo.environment["INKFLIT_HIDDEN_READY_PATH"] {
                DispatchQueue.main.asyncAfter(deadline:.now()+1) { [self] in
                    app.hideWindow()
                    DispatchQueue.main.asyncAfter(deadline:.now()+0.5) { [self] in
                        guard !app.window.isVisible else { fail("test window did not hide") }
                        do { try "hidden".write(toFile:hiddenPath,atomically:true,encoding:.utf8) } catch { fail("could not signal hidden window") }
                    }
                }
            }
        }
    }
    static func startAutomationUI(_ app: AppDelegate) {
        running=NativeCodeEditingTest(app);app.window.setContentSize(NSSize(width:360,height:560));app.showWindow()
        DispatchQueue.main.asyncAfter(deadline:.now()+0.8) { running?.testAutomationUI() }
    }
    private func testAutomationUI() {
        key(3,"F","f",[.command,.shift]); later { [self] in
            app.web.evaluateJavaScript("[document.getElementById('search-panel').hidden,document.activeElement.id]") { [self] value,error in
                guard error == nil, let result=value as? [Any], result[0] as? Bool == false, result[1] as? String == "search-input" else { fail("search shortcut did not open focused search") }
                sequence([{ self.key(11,"b") }, { self.key(14,"e") }, { self.key(17,"t") }, { self.key(0,"a") }]) { [self] in
                    app.web.evaluateJavaScript("[...document.querySelectorAll('.search-result')].map(e=>e.textContent)") { [self] value,error in
                        guard error == nil, let rows=value as? [String], rows.count==1, rows[0].contains("Beta") else { fail("search results: \(String(describing:value))") }
                        captureSearchIfRequested { [self] in
                        key(36,"\r"); later { [self] in
                            app.web.evaluateJavaScript("[JSON.parse(window.exportNotesJSON()).selected,document.getElementById('search-panel').hidden]") { [self] value,error in
                                guard error == nil, let result=value as? [Any], result[0] as? String == "second", result[1] as? Bool == true else { fail("search did not open matching note") }
                                key(3,"F","f",[.command,.shift]);key(53,"\u{1b}");later { [self] in
                                    guard app.window.isVisible else { fail("Escape closed window instead of search") }
                                    print("PASS native search shortcut, live filtering, selection and Escape")
                                    testAutomationScheme()
                                }
                            }
                        }
                        }
                    }
                }
            }
        }
    }
    private func captureSearchIfRequested(_ completion: @escaping () -> Void) {
        guard let path=ProcessInfo.processInfo.environment["INKFLIT_SEARCH_CAPTURE"] else { completion();return }
        app.web.takeSnapshot(with:nil) { [self] image,error in
            guard error == nil, let tiff=image?.tiffRepresentation, let rep=NSBitmapImageRep(data:tiff),
                  let png=rep.representation(using:.png,properties:[:]) else { fail("could not capture search") }
            do { try png.write(to:URL(fileURLWithPath:path));completion() } catch { fail("could not save search capture") }
        }
    }
    private func testAutomationScheme() {
        let urls=["inkflit://note/create?content=Scheme%20first&position=first", "inkflit://note/append?index=1&content=Scheme%20append", "inkflit://note/replace?index=2&content=Scheme%20replace"]
        app.application(NSApp,open:urls.compactMap(URL.init(string:)))
        DispatchQueue.main.asyncAfter(deadline:.now()+1) { [self] in
            app.web.evaluateJavaScript("JSON.parse(window.exportNotesJSON()).notes.map(n=>n.content)") { [self] value,error in
                guard error == nil, let texts=value as? [String], texts == ["Scheme first\nScheme append","Scheme replace","Beta note"] else { fail("scheme mutations: \(String(describing:value))") }
                app.application(NSApp,open:[URL(string:"inkflit://note/search?query=Beta")!])
                later { [self] in
                    app.web.evaluateJavaScript("[document.getElementById('search-input').value,document.querySelectorAll('.search-result').length]") { [self] value,error in
                        guard error == nil, let result=value as? [Any], result[0] as? String == "Beta", result[1] as? Int == 1 else { fail("scheme search") }
                        app.application(NSApp,open:[URL(string:"inkflit://note/get?index=3&x-success=shortcuts%3A%2F%2Fdone")!])
                        later { [self] in
                            guard let callback=app.testAutomationCallbacks.last, let encoded=URLComponents(url:callback,resolvingAgainstBaseURL:false)?.queryItems?.first(where:{$0.name=="result"})?.value,
                                  let data=encoded.data(using:.utf8), let value=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any],
                                  let note=value["note"] as? [String:Any], note["content"] as? String == "Beta note" else { fail("scheme get callback") }
                            app.application(NSApp,open:[URL(string:"inkflit://note/get?index=999&x-error=shortcuts%3A%2F%2Ferror")!])
                            later { [self] in
                                guard app.testAutomationCallbacks.count==2, let callback=app.testAutomationCallbacks.last,
                                      let encoded=URLComponents(url:callback,resolvingAgainstBaseURL:false)?.queryItems?.first(where:{$0.name=="result"})?.value,
                                      let data=encoded.data(using:.utf8), let value=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any], value["error"] is String else { fail("scheme error callback") }
                                app.application(NSApp,open:[URL(string:"inkflit://note/get?index=1")!])
                                later { [self] in
                                app.application(NSApp,open:[URL(string:"inkflit://note/delete?index=1")!])
                                DispatchQueue.main.asyncAfter(deadline:.now()+0.5) { [self] in
                            do {
                                let snapshot=try NoteFiles.read(app.storageURL.deletingLastPathComponent())
                                guard snapshot.notes.map(\.content) == ["Scheme replace","Beta note"] else { fail("scheme delete not persisted") }
                                let trash=app.storageURL.deletingLastPathComponent().appendingPathComponent("trash")
                                guard !(try FileManager.default.contentsOfDirectory(atPath:trash.path)).isEmpty else { fail("scheme deletion bypassed trash") }
                            } catch { fail("could not read scheme test files: \(error)") }
                            app.web.evaluateJavaScript("document.querySelector('.cm-content')?.textContent") { [self] value,error in
                                guard error == nil, let text=value as? String, text.contains("Scheme replace") else { fail("cached editor did not reflect external replacement") }
                                let delete=URL(string:"inkflit://note/delete?index=1")!
                                app.application(NSApp,open:[delete,delete])
                                DispatchQueue.main.asyncAfter(deadline:.now()+0.6) { [self] in
                                    do {
                                        let snapshot=try NoteFiles.read(app.storageURL.deletingLastPathComponent())
                                        guard snapshot.notes.count==1, snapshot.notes[0].content.isEmpty else { fail("deleting last note did not create a blank note") }
                                    } catch { fail("could not read final scheme state") }
                                    app.application(NSApp,open:[URL(string:"inkflit://note/create?content=Tail&position=last")!,URL(string:"inkflit://note/create?content=Head&position=1")!])
                                    DispatchQueue.main.asyncAfter(deadline:.now()+0.6) { [self] in
                                        do { let snapshot=try NoteFiles.read(app.storageURL.deletingLastPathComponent());guard snapshot.notes.map(\.content) == ["Head","","Tail"] else { fail("scheme create position was not persisted") } }
                                        catch { fail("could not read scheme position test") }
                                        print("PASS scheme create, position, append, replace, search, callbacks, cached editor and deletion with trash")
                                        app.restoreInputSource();exit(0)
                                    }
                                }
                            }
                                }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    static func startPlacement(_ app: AppDelegate) {
        running=NativeCodeEditingTest(app)
        DispatchQueue.main.asyncAfter(deadline:.now()+0.8) { running?.testPlacement() }
    }
    private func testPlacement() {
        if ["legacy", "v2"].contains(ProcessInfo.processInfo.environment["INKFLIT_PLACEMENT_RESTART"] ?? "") {
            guard let screen=app.window.screen, let target=NSScreen.screens.first(where: { $0.frame.contains(NSEvent.mouseLocation) }) else { fail("legacy placement screen unavailable") }
            let source=screen.visibleFrame, size=app.window.frame.size
            let version=ProcessInfo.processInfo.environment["INKFLIT_PLACEMENT_RESTART"] == "legacy" ? 1 : 2
            UserDefaults.standard.set(["version":version,"right":true,"top":true,"horizontal":version == 1 ? 45.0 : 45/source.width,"vertical":version == 1 ? 35.0 : 35/source.height],forKey:"windowAnchor")
            app.window.orderOut(nil); app.showWindow()
            let x=45/(source.width-size.width), y=35/(source.height-size.height)
            let anchor=WindowPlacement.Anchor(left:1-x,right:x,bottom:1-y,top:y)
            let expected=WindowPlacement.frame(size:size,anchor:anchor,in:target.visibleFrame), actual=app.window.frame
            guard abs(actual.minX-expected.minX)<2, abs(actual.minY-expected.minY)<2,
                  UserDefaults.standard.dictionary(forKey:"windowAnchor")?["version"] as? Int == 3 else { fail("legacy window position migration") }
            print("PASS previous edge position converts to percentages"); app.restoreInputSource(); exit(0)
        }
        if ProcessInfo.processInfo.environment["INKFLIT_PLACEMENT_RESTART"] == "1" {
            guard UserDefaults.standard.bool(forKey:"testHasMultipleScreens") else { print("SKIP placement restart: only one display"); exit(0) }
            guard let target=NSScreen.screens.first(where: { $0.frame.contains(NSEvent.mouseLocation) }) else { fail("mouse screen unavailable") }
            let frame=app.window.frame, visible=target.visibleFrame
            let xRatio=UserDefaults.standard.double(forKey:"testHorizontalRatio"), yRatio=UserDefaults.standard.double(forKey:"testVerticalRatio")
            guard abs(visible.maxX-frame.maxX-xRatio*(visible.width-frame.width))<2, abs(visible.maxY-frame.maxY-yRatio*(visible.height-frame.height))<2 else { fail("remembered edge position after restart: \(frame)") }
            print("PASS window edge position is restored after restart"); app.restoreInputSource(); exit(0)
        }
        let source=NSRect(x:0,y:0,width:1000,height:800), target=NSRect(x:-1200,y:100,width:1200,height:900)
        let leftBottom=WindowPlacement.onScreen(NSRect(x:50,y:90,width:200,height:300),from:source,to:target)
        guard leftBottom == NSRect(x:-1137.5,y:208,width:200,height:300) else { fail("left/bottom anchor incorrect: \(leftBottom)") }
        let rightTop=WindowPlacement.onScreen(NSRect(x:740,y:460,width:200,height:300),from:source,to:target)
        guard rightTop == NSRect(x:-275,y:652,width:200,height:300) else { fail("right/top anchor incorrect: \(rightTop)") }
        for x in [CGFloat(0), 150, 400, 650, 800] {
            for y in [CGFloat(0), 100, 250, 400, 500] {
                let original=NSRect(x:x,y:y,width:200,height:300)
                let before=WindowPlacement.anchor(original,in:source)
                let mapped=WindowPlacement.onScreen(original,from:source,to:target)
                let after=WindowPlacement.anchor(mapped,in:target)
                guard abs(before.left-after.left)<0.000001, abs(before.right-after.right)<0.000001,
                      abs(before.top-after.top)<0.000001, abs(before.bottom-after.bottom)<0.000001 else { fail("four edge proportions changed after screen switch") }
                let restored=WindowPlacement.onScreen(mapped,from:target,to:source)
                guard abs(restored.minX-original.minX)<0.001, abs(restored.minY-original.minY)<0.001 else { fail("window position drifted after screen round trip") }
            }
        }
        let fill=WindowPlacement.anchor(NSRect(x:0,y:0,width:1000,height:800),in:source)
        guard fill.left==0.5, fill.right==0.5, fill.top==0.5, fill.bottom==0.5 else { fail("zero travel range is not handled") }
        let tiny=NSRect(x:30,y:-30,width:100,height:120)
        let fitted=WindowPlacement.onScreen(NSRect(x:740,y:460,width:200,height:300),from:source,to:tiny)
        guard tiny.contains(fitted), fitted.size == tiny.size else { fail("small screen fitting incorrect") }
        for value in 0...100 {
            guard SettingsController.sliderValue(value,optionPressed:false)==value,
                  SettingsController.sliderValue(value,optionPressed:true)%5==0,
                  abs(SettingsController.sliderValue(value,optionPressed:true)-value)<=2 else { fail("Option snap calculation for \(value)") }
        }
        print("PASS four screen edges, fitting and 5% slider snap")
        if let destination=NSScreen.screens.first(where: { $0.frame.contains(NSEvent.mouseLocation) }),
           let other=NSScreen.screens.first(where: { $0 !== destination && $0.frame != destination.frame }) {
            let screen=other.visibleFrame
            let frame=NSRect(x:screen.maxX-360-45,y:screen.maxY-480-35,width:360,height:480)
            app.window.setFrame(frame,display:false)
            guard app.window.screen?.frame == other.frame else { fail("could not move isolated window to another screen") }
            DispatchQueue.main.asyncAfter(deadline:.now()+0.3) { [self] in
                guard let saved=UserDefaults.standard.dictionary(forKey:"windowAnchor"),
                      abs((saved["right"] as? Double ?? -1)-45/(screen.width-360))<0.001,
                      abs((saved["top"] as? Double ?? -1)-35/(screen.height-480))<0.001,
                      abs((saved["left"] as? Double ?? -1)+(saved["right"] as? Double ?? -1)-1)<0.001,
                      abs((saved["bottom"] as? Double ?? -1)+(saved["top"] as? Double ?? -1)-1)<0.001 else { fail("window edge position was not saved: \(String(describing: UserDefaults.standard.dictionary(forKey: "windowAnchor"))) screen \(screen)") }
                UserDefaults.standard.set(true,forKey:"testHasMultipleScreens")
                UserDefaults.standard.set(45/(screen.width-360),forKey:"testHorizontalRatio"); UserDefaults.standard.set(35/(screen.height-480),forKey:"testVerticalRatio")
                app.window.orderOut(nil)
                let expected=WindowPlacement.onScreen(frame,from:screen,to:destination.visibleFrame)
                app.showWindow()
                let actual=app.window.frame
                guard abs(actual.minX-expected.minX)<2, abs(actual.minY-expected.minY)<2 else { fail("mouse-screen placement: expected \(expected), got \(actual)") }
                print("PASS actual multi-screen summon preserves edge percentages")
                testPlacementSliders()
            }
            return
        } else { print("SKIP real multi-screen summon: only one display available") }
        testPlacementSliders()
    }
    private func testPlacementSliders() {
        app.showSettings()
        guard let settings=app.settingsController else { fail("settings missing") }
        settings.testSelectSettingsTab(1)
        for blur in [false,true] {
            guard let free=settings.testClickSlider(blur:blur,option:false), let snapped=settings.testClickSlider(blur:blur,option:true) else { fail("could not click slider") }
            guard free%5 != 0, snapped%5 == 0, abs(snapped-free)<=3 else { fail("Option slider mouse interaction: free \(free), snapped \(snapped)") }
            guard let freeDrag=settings.testDragSlider(blur:blur,option:false), let snappedDrag=settings.testDragSlider(blur:blur,option:true),
                  freeDrag%5 != 0, snappedDrag%5 == 0, abs(snappedDrag-freeDrag)<=3 else { fail("Option slider drag interaction") }
        }
        print("PASS opacity and blur slider clicks and drags with and without Option")
        app.restoreInputSource(); exit(0)
    }
    static func startToolbarCursor(_ app: AppDelegate) {
        running=NativeCodeEditingTest(app); app.showWindow()
        DispatchQueue.main.asyncAfter(deadline:.now()+1) { running?.testToolbarCursor(0,original:CGEvent(source:nil)?.location ?? .zero) }
    }
    private func testToolbarCursor(_ index: Int, original: CGPoint) {
        guard AXIsProcessTrusted() else { print("SKIP native cursor test: Accessibility permission unavailable"); exit(0) }
        guard let root=app.window.contentView, let primary=NSScreen.screens.first else { CGWarpMouseCursorPosition(original); fail("cursor test screen unavailable") }
        guard app.toolbarDrag.buttonRects.count == 5 else { CGWarpMouseCursorPosition(original); fail("cursor test button regions unavailable") }
        let button=app.toolbarDrag.buttonRects[2]
        let points=[NSPoint(x:root.bounds.midX,y:root.bounds.height-110), NSPoint(x:root.bounds.midX,y:root.bounds.height-25), NSPoint(x:button.midX,y:root.bounds.height-button.midY), NSPoint(x:root.bounds.midX,y:root.bounds.height-110)]
        guard index < points.count else { CGWarpMouseCursorPosition(original); print("PASS pointer switches between editor and toolbar"); app.restoreInputSource(); exit(0) }
        let screen=app.window.convertPoint(toScreen:points[index]), location=CGPoint(x:screen.x,y:primary.frame.maxY-screen.y)
        CGEvent(mouseEventSource:nil,mouseType:.mouseMoved,mouseCursorPosition:location,mouseButton:.left)?.post(tap:.cghidEventTap)
        DispatchQueue.main.asyncAfter(deadline:.now()+0.4) { [self] in
            guard let cursor=NSCursor.currentSystem else { CGWarpMouseCursorPosition(original); fail("system pointer unavailable") }
            let data=cursor.image.tiffRepresentation
            let expected=(index == 1 ? NSCursor.arrow : index == 2 ? NSCursor.pointingHand : NSCursor.iBeam).image.tiffRepresentation
            guard data == expected else {
                let kind=index == 1 ? "arrow" : index == 2 ? "hand" : "text"; CGWarpMouseCursorPosition(original)
                fail("expected \(kind) pointer at step \(index), system hotspot \(cursor.hotSpot), size \(cursor.image.size)")
            }
            testToolbarCursor(index+1,original:original)
        }
    }
    static func startRealToolbarDrag(_ app: AppDelegate) {
        running=NativeCodeEditingTest(app); app.showWindow()
        DispatchQueue.main.asyncAfter(deadline:.now()+1) { running?.testRealToolbarDrag(0, original: CGEvent(source:nil)?.location ?? .zero) }
    }
    private func testRealToolbarDrag(_ index: Int, original: CGPoint) {
        guard AXIsProcessTrusted() else { print("SKIP real toolbar drag: Accessibility permission unavailable"); exit(0) }
        guard index<6 else { CGWarpMouseCursorPosition(original); print("PASS real mouse drags across toolbar gaps, top strip and page number"); app.restoreInputSource(); exit(0) }
        guard let root=app.window.contentView, let screen=app.window.screen, let primary=NSScreen.screens.first else { CGWarpMouseCursorPosition(original); fail("screen not available") }
        let buttons=app.toolbarDrag.buttonRects
        guard buttons.count==5 else { CGWarpMouseCursorPosition(original); fail("toolbar buttons unavailable") }
        let positions: [CGPoint] = [CGPoint(x:8,y:28), CGPoint(x:(buttons[0].maxX+buttons[1].minX)/2,y:28), CGPoint(x:root.bounds.midX,y:28), CGPoint(x:(buttons[2].maxX+buttons[3].minX)/2,y:28), CGPoint(x:root.bounds.midX,y:5), CGPoint(x:root.bounds.maxX-8,y:28)]
        let point=positions[index]
        guard root.hitTest(NSPoint(x:point.x,y:root.bounds.height-point.y)) is ToolbarDragView else { CGWarpMouseCursorPosition(original); fail("real drag start is not draggable") }
        let before=app.window.frame, viewPoint=NSPoint(x:point.x,y:root.bounds.height-point.y)
        let appKitPoint=app.window.convertPoint(toScreen:viewPoint)
        let start=CGPoint(x:appKitPoint.x,y:primary.frame.maxY-appKitPoint.y)
        let dx: CGFloat = before.maxX+36 < screen.visibleFrame.maxX ? 30 : -30
        let dy: CGFloat = before.minY-24 > screen.visibleFrame.minY ? 18 : -18
        DispatchQueue.global(qos:.userInitiated).async {
            func post(_ type: CGEventType, _ position: CGPoint) { CGEvent(mouseEventSource:nil,mouseType:type,mouseCursorPosition:position,mouseButton:.left)?.post(tap:.cghidEventTap) }
            post(.mouseMoved,start); usleep(100_000); post(.leftMouseDown,start); usleep(100_000)
            for step in 1...6 { post(.leftMouseDragged,CGPoint(x:start.x+dx*CGFloat(step)/6,y:start.y+dy*CGFloat(step)/6)); usleep(50_000) }
            post(.leftMouseUp,CGPoint(x:start.x+dx,y:start.y+dy))
            DispatchQueue.main.asyncAfter(deadline:.now()+0.35) { [self] in
                let after=app.window.frame
                guard abs(after.minX-before.minX)>10 || abs(after.minY-before.minY)>10 else { CGWarpMouseCursorPosition(original); fail("real drag did not move window at \(point)") }
                testRealToolbarDrag(index+1,original:original)
            }
        }
    }
    static func startHeaderDrag(_ app: AppDelegate) {
        running=NativeCodeEditingTest(app); app.showWindow()
        DispatchQueue.main.asyncAfter(deadline: .now()+0.8) { running?.testHeaderHitRegions(0) }
    }
    private func testHeaderHitRegions(_ index: Int) {
        let widths: [CGFloat] = [300, 480, 680]
        guard index < widths.count else { testToolbarDynamicLayout(); return }
        app.window.setContentSize(NSSize(width:widths[index],height:500))
        DispatchQueue.main.asyncAfter(deadline: .now()+0.4) { [self] in
            guard let root=app.window.contentView else { fail("missing window content") }
            let overlay=app.toolbarDrag!
            guard overlay.buttonRects.count==5, abs(overlay.measuredWidth-root.bounds.width)<1 else { fail("toolbar layout not synchronized") }
            var draggable=0, buttons=0
            for y in stride(from: CGFloat(2), through: 44, by: 4) {
                for x in stride(from: CGFloat(2), through: root.bounds.width-2, by: 4) {
                    let local=NSPoint(x:x,y:y), expectedButton=overlay.buttonRects.contains { $0.insetBy(dx: -0.3, dy: -0.3).contains(local) }
                    let closeToButton=overlay.buttonRects.contains { $0.insetBy(dx: -1.5, dy: -1.5).contains(local) && !$0.insetBy(dx: 1.5, dy: 1.5).contains(local) }
                    if closeToButton { continue }
                    let hit=root.hitTest(NSPoint(x:x,y:root.bounds.height-y))
                    if expectedButton { buttons += 1; if hit is ToolbarDragView { fail("button covered at \(x), \(y)") } }
                    else { draggable += 1; if !(hit is ToolbarDragView) { fail("toolbar gap cannot drag at \(x), \(y)") } }
                }
            }
            guard buttons>20 && draggable>100 else { fail("toolbar test did not cover regions") }
            print("PASS toolbar button and drag regions at width \(Int(widths[index]))")
            testHeaderHitRegions(index+1)
        }
    }
    private func testToolbarDynamicLayout() {
        app.web.evaluateJavaScript("document.getElementById('position').textContent = '100000 / 100000'") { [self] _,error in
            guard error == nil else { fail("could not enlarge page number") }
            DispatchQueue.main.asyncAfter(deadline:.now()+0.3) { [self] in
                app.web.evaluateJavaScript("document.getElementById('next').getBoundingClientRect().x") { [self] value,error in
                    guard error == nil, let x=value as? Double, abs(app.toolbarDrag.buttonRects[1].minX-x)<0.5 else { fail("toolbar button region did not follow page number width") }
                    print("PASS toolbar regions track changing page-number width")
                    app.web.evaluateJavaScript("document.getElementById('position').textContent = '1 / 2'") { [self] _,error in
                        guard error == nil else { fail("could not restore page number") }
                        DispatchQueue.main.asyncAfter(deadline:.now()+0.3) { [self] in testToolbarClicks() }
                    }
                }
            }
        }
    }
    private func clickToolbarButton(_ index: Int) {
        let rect=app.toolbarDrag.buttonRects[index], root=app.window.contentView!
        let pos=NSPoint(x:rect.midX,y:root.bounds.height-rect.midY)
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
            guard let event=NSEvent.mouseEvent(with:type,location:pos,modifierFlags:[],timestamp:ProcessInfo.processInfo.systemUptime,windowNumber:app.window.windowNumber,context:nil,eventNumber:1,clickCount:1,pressure:1) else { fail("cannot create mouse event") }
            app.window.sendEvent(event)
        }
    }
    private func testToolbarClicks() {
        clickToolbarButton(1)
        later { [self] in
            app.web.evaluateJavaScript("JSON.parse(window.exportNotesJSON()).selected") { [self] value,error in
                guard error == nil, value as? String == "second" else { fail("next button click: \(String(describing:value))") }
                clickToolbarButton(0); later { [self] in
                    app.web.evaluateJavaScript("JSON.parse(window.exportNotesJSON()).selected") { [self] value,error in
                        guard error == nil, value as? String == "first" else { fail("previous button click: \(String(describing:value))") }
                        clickToolbarButton(2); later { [self] in
                            app.web.evaluateJavaScript("JSON.parse(window.exportNotesJSON()).notes.length") { [self] value,error in
                                guard error == nil, value as? Int == 3 else { fail("new button click: \(String(describing:value))") }
                                app.web.evaluateJavaScript("window.confirm = () => { window.__deleteAsked = true; return false; }; true") { [self] _,error in
                                    guard error == nil else { fail("could not set up delete confirmation") }
                                    clickToolbarButton(3); later { [self] in
                                        app.web.evaluateJavaScript("[window.__deleteAsked === true, JSON.parse(window.exportNotesJSON()).notes.length]") { [self] value,error in
                                            guard error == nil, let result=value as? [Any], result.count==2, result[0] as? Bool == false, result[1] as? Int == 2 else { fail("delete button did not delete without confirmation") }
                                            clickToolbarButton(4); later { [self] in
                                                app.web.evaluateJavaScript("document.getElementById('search-panel').hidden") { [self] value,error in
                                                    guard error == nil, value as? Bool == false else { fail("search button did not open search") }
                                                    print("PASS native toolbar mouse clicks, search and immediate delete"); app.restoreInputSource(); exit(0)
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    static func startSettingsAccent(_ app: AppDelegate) {
        running=NativeCodeEditingTest(app)
        DispatchQueue.main.asyncAfter(deadline: .now()+0.8) { running?.testSettingsAccent() }
    }
    private func testSettingsAccent() {
        app.showSettings()
        guard let settings=app.settingsController else { fail("settings unavailable") }
        settings.testSelectSettingsTab(1)
        for theme in ["orange", "blue", "green"] {
            guard settings.testSetAppearance(WindowAppearance(theme: theme, opacity: 85, blur: 75)),
                  settings.testAppearanceControls(theme) else { fail("accent or ticks not updated: \(theme)") }
            guard settings.testSetSliderValues(opacity: 83, blur: 37),
                  app.windowAppearance().opacity == 83, app.windowAppearance().blur == 37 else { fail("slider values did not persist continuously: \(theme)") }
            settings.refresh()
            guard settings.testAppearanceControls(theme) else { fail("accent not retained on refresh: \(theme)") }
            print("PASS \(theme) settings accents, tick marks and continuous values")
        }
        let capture=ProcessInfo.processInfo.environment["INKFLIT_SETTINGS_CAPTURE"]
        if let capture, !settings.testSaveSettingsScreenshot(capture) { fail("settings capture failed") }
        app.restoreInputSource(); exit(0)
    }
    static func startBlockCalculation(_ app: AppDelegate) {
        running = NativeCodeEditingTest(app); app.showWindow()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { running?.testVariableHighlightEditing() }
    }
    private func testVariableHighlightEditing() {
        key(7,"x"); later { [self] in
            app.web.evaluateJavaScript("[...document.querySelectorAll('.cm-math-variable')].map(x=>x.textContent)") { [self] value,error in
                guard error == nil, let markers=value as? [String], markers == ["rice"] else { fail("variable highlighting after editing definition: \(String(describing:value))") }
                key(32,"u"); later { [self] in
                    app.web.evaluateJavaScript("[...document.querySelectorAll('.cm-math-variable')].map(x=>x.textContent)") { [self] value,error in
                        guard error == nil, let markers=value as? [String], markers == ["price", "price"] else { fail("variable highlighting after undo: \(String(describing:value))") }
                        print("PASS variable highlighting updates after edit and undo")
                        checkCalculation("math")
                    }
                }
            }
        }
    }
    private func checkCalculation(_ mode: String) {
        let body="price: 80\nprice * 2 =\n10 km to mi ="
        content { [self] text in
            expect(text,":::inkflit \(mode)\n\(body)\n:::end","\(mode) preserves block body")
            let styleCheck="""
            (()=>{ const markers=[...document.querySelectorAll('.cm-math-variable')]; if ('\(mode)'!=='math') return markers.length===0; if(markers.length!==2 || markers.some(x=>x.textContent!=='price')) return false; const p=document.createElement('span'); document.body.append(p); let ok=true; for(const theme of ['orange','blue','green']) { window.setUIAppearance(theme,100); p.style.color=getComputedStyle(document.documentElement).getPropertyValue('--ui-button'); if(markers.some(marker=>getComputedStyle(marker).color!==getComputedStyle(p).color || Number(getComputedStyle(marker).fontWeight)<600)) ok=false; } p.remove(); return ok; })()
            """
            app.web.evaluateJavaScript(styleCheck) { [self] value,error in
                guard error == nil, value as? Bool == true else { fail("variable definition styling for \(mode)") }
                self.checkCalculationResults(mode)
            }
        }
    }
    private func checkCalculationResults(_ mode: String) {
            app.web.evaluateJavaScript("[...document.querySelectorAll('.calculation-result')].map(x=>x.textContent.trim())") { [self] value,error in
                guard error == nil, let results=value as? [String] else { fail("cannot read calculation results") }
                if mode == "math" {
                    guard results.count == 2, results[0] == "160", results[1].contains("6.213711922 mi") else { fail("math results: \(results)") }
                    if ProcessInfo.processInfo.environment["INKFLIT_CALC_RETURNED"] == "1" { app.restoreInputSource(); exit(0) }
                    switchCalculation(to:"sum")
                } else if mode == "sum" {
                    guard results.count == 1, results[0].contains("92"), results[0].contains("3") else { fail("sum results: \(results)") }
                    switchCalculation(to:"avg")
                } else {
                    guard results.count == 1, results[0].contains("30.66666667"), results[0].contains("3") else { fail("average results: \(results)") }
                    switchCalculation(to:"math", finish:true)
                }
            }
    }
    private func switchCalculation(to mode: String, finish: Bool = false) {
        let script="""
        (()=>{ document.querySelector('.block-type')?.click(); const item=[...document.querySelectorAll('.block-menu-item')].find(x=>x.querySelector('kbd')?.textContent==='\(mode)'); if(!item)return false; item.click(); return true; })()
        """
        app.web.evaluateJavaScript(script) { [self] value,error in
            guard error == nil, value as? Bool == true else { fail("cannot switch block to \(mode)") }
            later { [self] in
                if finish {
                    content { [self] text in
                        expect(text,":::inkflit math\nprice: 80\nprice * 2 =\n10 km to mi =\n:::end","return to math preserves block body")
                        app.web.evaluateJavaScript("[...document.querySelectorAll('.calculation-result')].map(x=>x.textContent.trim())") { [self] value,error in
                            guard error == nil, let results=value as? [String], results.count==2, results[0]=="160", results[1].contains("6.213711922 mi") else { fail("math results after switching back: \(String(describing:value))") }
                            app.web.evaluateJavaScript("[...document.querySelectorAll('.cm-math-variable')].map(x=>x.textContent)") { [self] value,error in
                                guard error == nil, let markers=value as? [String], markers == ["price", "price"] else { fail("variable highlighting not restored after switching back: \(String(describing:value))") }
                                print("PASS native block type switch refreshes results, highlighting and preserves content"); app.restoreInputSource(); exit(0)
                            }
                        }
                    }
                } else { checkCalculation(mode) }
            }
        }
    }
    static func startSnippets(_ app: AppDelegate) {
        running=NativeCodeEditingTest(app);app.showWindow()
        DispatchQueue.main.asyncAfter(deadline:.now()+0.7) { running?.testSnippets() }
    }
    /// Types "@ip" in the real page: previews must come from the network and from
    /// the app, not only in a browser.
    private func testSnippets() {
        let rows = "[...document.querySelectorAll('.cm-tooltip-autocomplete li')].map(li=>[li.querySelector('.cm-completionLabel')?.textContent,li.querySelector('.cm-completionDetail')?.textContent])"
        sequence([{ self.key(34,"i") }, { self.key(19,"@","2",.shift) }, { self.key(34,"i") }, { self.key(35,"p") }]) { [self] in
            DispatchQueue.main.asyncAfter(deadline:.now()+4) { [self] in
                app.web.evaluateJavaScript(rows) { [self] value,error in
                    print("snippet rows: \(String(describing: value)) error: \(String(describing: error))")
                    // "@ip" opens the whole group; one of its rows previews the public IPv4.
                    guard error == nil, let list = value as? [[Any]], list.count == 4,
                          list.contains(where: { ($0.last as? String)?.range(of: #"^\d+\.\d+\.\d+\.\d+$"#, options: .regularExpression) != nil }) else { fail("@ip previews missing in the app") }
                    print("PASS native public IP preview")
                    testUserSnippets()
                }
            }
        }
    }
    /// Settings → Snippets writes snippets.json and the note window offers the rows.
    private func testUserSnippets() {
        key(53,"\u{1b}"); key(53,"\u{1b}")
        app.showSettings()
        guard let settings = app.settingsController else { fail("settings missing") }
        guard settings.testTabCount() == 5 else { fail("settings should have five tabs") }
        if let directory = ProcessInfo.processInfo.environment["INKFLIT_SETTINGS_CAPTURE_DIR"], !directory.isEmpty {
            for tab in [SettingsController.Tab.general, .appearance, .edit, .snippets, .data] {
                settings.select(tab); settings.window?.contentView?.layoutSubtreeIfNeeded(); settings.window?.displayIfNeeded()
                RunLoop.current.run(until: Date().addingTimeInterval(0.3))
                // screencapture draws the real window, text and controls included.
                let capture = Process(); capture.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
                capture.arguments = ["-x", "-o", "-l\(settings.window?.windowNumber ?? 0)", "\(directory)/settings-\(tab.rawValue).png"]
                try? capture.run(); capture.waitUntilExit()
            }
        }
        settings.select(.snippets)
        let editor = settings.testSnippetsEditor()
        guard editor.testIsEditable(), editor.testRows().isEmpty else { fail("snippets editor should start empty") }
        editor.testAdd(trigger: "addr", content: "Home")
        editor.testAdd(trigger: "addr", content: "first")
        editor.testEditSelectedContent("Office\nFloor 3")
        editor.testAdd(trigger: "Bad trigger", content: "ignored")
        let directory = app.storageURL.deletingLastPathComponent()
        guard let saved = try? NoteFiles.readSnippets(directory), saved == [UserSnippet(trigger: "addr", content: "Home"), UserSnippet(trigger: "addr", content: "Office\nFloor 3")] else { fail("snippets.json: \(String(describing: try? NoteFiles.readSnippets(directory)))") }
        guard editor.testStatus() == L("settings.snippetInvalidTrigger") else { fail("status after saving: \(editor.testStatus())") }
        print("PASS native snippets settings save")
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        let tokens = editor.testPlaceholderTokens()
        guard tokens.contains("ipv4"), tokens.contains("date#2"), tokens.contains("timesec") else { fail("placeholder menu: \(tokens)") }
        editor.testAdd(trigger: "ip4", content: "IP ")
        guard editor.testInsertPlaceholder("ipv4") == "IP {ipv4}", (try? NoteFiles.readSnippets(directory))?.last == UserSnippet(trigger: "ip4", content: "IP {ipv4}") else { fail("insert placeholder") }
        print("PASS native placeholder menu")
        settings.window?.orderOut(nil); app.showWindow()
        DispatchQueue.main.asyncAfter(deadline:.now()+0.5) { [self] in
            sequence([{ self.key(31,"o") }, { self.key(19,"@","2",.shift) }, { self.key(0,"a") }, { self.key(2,"d") }, { self.key(2,"d") }, { self.key(15,"r") }]) { [self] in
                DispatchQueue.main.asyncAfter(deadline:.now()+2) { [self] in
                    app.web.evaluateJavaScript("[...document.querySelectorAll('.cm-tooltip-autocomplete li')].map(li=>li.querySelector('.cm-completionDetail')?.textContent)") { [self] value,error in
                        guard error == nil, let details = value as? [String], details == ["Home", "Office …"] else { fail("@addr rows: \(String(describing: value))") }
                        print("PASS native user snippets in the editor")
                        app.restoreInputSource(); exit(0)
                    }
                }
            }
        }
    }
    static func startCommandPalette(_ app: AppDelegate) {
        running=NativeCodeEditingTest(app);app.showWindow()
        DispatchQueue.main.asyncAfter(deadline:.now()+0.7) { running?.testCommandPalette() }
    }
    private func testCommandPalette() {
        key(35,"P","p",[.command,.shift]);later { [self] in
            app.web.evaluateJavaScript("[document.getElementById('command-panel').hidden,document.activeElement.id,document.querySelectorAll('.command-row').length]") { [self] value,error in
                guard error == nil, let v=value as? [Any],v[0] as? Bool == false,v[1] as? String == "command-input",(v[2] as? Int ?? 0)>10 else { fail("command palette did not open: \(String(describing:value))") }
                key(125,"\u{f701}");later { [self] in
                    app.web.evaluateJavaScript("document.querySelector('.command-row[aria-selected=true]')?.id") { [self] value,error in
                        guard error == nil,value as? String == "command-option-1" else { fail("command keyboard navigation") }
                        key(53,"\u{1b}");later { [self] in
                            guard app.window.isVisible else { fail("command Escape hid window") }
                            key(35,"P","p",[.command,.shift]);later { [self] in
                                sequence([{ self.key(9,"v") }, { self.key(34,"i") }, { self.key(46,"m") }, { self.key(36,"\r") }]) { [self] in
                                    DispatchQueue.main.asyncAfter(deadline:.now()+0.4) { [self] in
                                        guard !app.vimEnabled(),UserDefaults.standard.object(forKey:"vimEnabled") as? Bool == false else { fail("palette did not persist Vim setting") }
                                        key(35,"P","p",[.command,.shift]);later { [self] in
                                            sequence([{ self.key(11,"b") }, { self.key(37,"l") }, { self.key(32,"u") }, { self.key(14,"e") }, { self.key(36,"\r") }]) { [self] in
                                                DispatchQueue.main.asyncAfter(deadline:.now()+0.4) { [self] in
                                                    guard app.windowAppearance().theme == "blue" else { fail("palette did not persist theme") }
                                                    if let path=ProcessInfo.processInfo.environment["INKFLIT_COMMAND_CAPTURE"] {
                                                        key(35,"P","p",[.command,.shift]);later { [self] in
                                                            app.web.takeSnapshot(with:nil) { [self] image,_ in
                                                                if let tiff=image?.tiffRepresentation,let rep=NSBitmapImageRep(data:tiff),let png=rep.representation(using:.png,properties:[:]) { try? png.write(to:URL(fileURLWithPath:path)) }
                                                                key(53,"\u{1b}");later { [self] in testCommandCreate() }
                                                            }
                                                        }
                                                    } else { testCommandCreate() }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    private func testCommandCreate() {
        key(35,"P","p",[.command,.shift]);later { [self] in
            sequence([{ self.key(45,"n") },{ self.key(14,"e") },{ self.key(13,"w") },{ self.key(36,"\r") }]) { [self] in
                app.web.evaluateJavaScript("[document.getElementById('command-panel').hidden,JSON.parse(window.exportNotesJSON()).notes.map(n=>n.content)]") { [self] value,error in
                    guard error == nil,let v=value as? [Any],v[0] as? Bool == true,let notes=v[1] as? [String],notes == ["initial",""] else { fail("palette create note: \(String(describing:value))") }
                    print("PASS command palette search, navigation, settings persistence, Escape and new note")
                    app.restoreInputSource();exit(0)
                }
            }
        }
    }
    static func startDeleteNotices(_ app: AppDelegate) {
        running=NativeCodeEditingTest(app);app.showWindow()
        DispatchQueue.main.asyncAfter(deadline:.now()+0.7) { running?.testDeleteNotices() }
    }
    private func testDeleteNotices() {
        app.web.evaluateJavaScript("window.confirm=()=>{window.__deleteAsked=true;return false};true") { [self] _,error in
            guard error == nil else { fail("could not install confirmation probe") }
            key(30,"]","]",.command);later { [self] in
                sequence([{ self.key(34,"i") }, { self.key(7,"x") }, { self.key(53,"\u{1b}") }]) { [self] in
                key(2,"d","d",.command);key(2,"d","d",.command)
                DispatchQueue.main.asyncAfter(deadline:.now()+1) { [self] in
                    app.web.evaluateJavaScript("[window.__deleteAsked===true,JSON.parse(window.exportNotesJSON()).notes.map(n=>n.content),[...document.querySelectorAll('.delete-notice-title')].map(n=>n.textContent),[...document.querySelectorAll('.delete-notice-time')].map(n=>parseInt(n.textContent)),getComputedStyle(document.querySelector('.delete-notice')).boxShadow]") { [self] value,error in
                        guard error == nil,let v=value as? [Any],v[0] as? Bool == false,let notes=v[1] as? [String],notes == ["alpha"],let titles=v[2] as? [String],Set(titles)==Set(["xbeta","gamma"]),let times=v[3] as? [Int],times.count==2,times.allSatisfy({$0>0 && $0<=12}),v[4] as? String == "none" else { fail("rapid delete notices: \(String(describing:value))") }
                        if let path=ProcessInfo.processInfo.environment["INKFLIT_DELETE_CAPTURE"] {
                            app.web.takeSnapshot(with:nil) { image,_ in
                                guard let tiff=image?.tiffRepresentation,let rep=NSBitmapImageRep(data:tiff),let png=rep.representation(using:.png,properties:[:]) else { return }
                                try? png.write(to:URL(fileURLWithPath:path))
                            }
                        }
                        do { let snap=try NoteFiles.read(app.storageURL.deletingLastPathComponent());guard snap.notes.map(\.content)==["alpha"] else { fail("rapid deletes not saved") } } catch { fail("cannot read after rapid deletion") }
                        app.web.evaluateJavaScript("[document.querySelector('.delete-notice.is-next .delete-notice-title')?.textContent,document.querySelectorAll('.delete-notice.is-next').length,document.querySelector('.delete-notice.is-next button')?.textContent]") { [self] value,error in
                            guard error == nil,let v=value as? [Any],v[0] as? String == "gamma",v[1] as? Int == 1,(v[2] as? String)?.contains("⌘U") == true else { fail("newest notice not highlighted: \(String(describing:value))") }
                            key(32,"u","u",.command); later { [self] in
                                app.web.evaluateJavaScript("[JSON.parse(window.exportNotesJSON()).notes.map(n=>n.content),document.querySelector('.delete-notice.is-next .delete-notice-title')?.textContent]") { [self] value,error in
                                    guard error == nil,let v=value as? [Any],v[0] as? [String] == ["alpha","gamma"],v[1] as? String == "xbeta" else { fail("first shortcut did not restore newest: \(String(describing:value))") }
                                    key(32,"u","u",.command)
                                    DispatchQueue.main.asyncAfter(deadline:.now()+0.7) { [self] in
                                        do { let snap=try NoteFiles.read(app.storageURL.deletingLastPathComponent());guard snap.notes.map(\.content)==["alpha","xbeta","gamma"] else { fail("restored notes lost order or content") } } catch { fail("cannot read restored notes") }
                                        key(2,"d","d",.command);key(2,"d","d",.command);key(2,"d","d",.command)
                                        DispatchQueue.main.asyncAfter(deadline:.now()+1) { [self] in
                                            app.web.evaluateJavaScript("[JSON.parse(window.exportNotesJSON()).notes.map(n=>n.content),document.querySelectorAll('.delete-notice').length]") { [self] value,error in
                                                guard error == nil, let v=value as? [Any],v[0] as? [String] == [""], v[1] as? Int == 3 else { fail("delete last note placeholder: \(String(describing:value))") }
                                                app.web.evaluateJavaScript("[...document.querySelectorAll('.delete-notice')].find(n=>n.querySelector('.delete-notice-title').textContent==='alpha').querySelector('button').click()") { [self] _,error in
                                                    guard error == nil else { fail("could not restore last note") }
                                                    DispatchQueue.main.asyncAfter(deadline:.now()+0.7) { [self] in
                                                        do { let snap=try NoteFiles.read(app.storageURL.deletingLastPathComponent());guard snap.notes.map(\.content)==["alpha"] else { fail("placeholder was not removed on restore") } } catch { fail("cannot read last note restore") }
                                                        DispatchQueue.main.asyncAfter(deadline:.now()+12.5) { [self] in
                                                            app.web.evaluateJavaScript("document.querySelectorAll('.delete-notice').length") { [self] value,error in
                                                                guard error == nil, value as? Int == 0 else { fail("delete notices did not expire") }
                                                                do { let trash=app.storageURL.deletingLastPathComponent().appendingPathComponent("trash");guard (try FileManager.default.contentsOfDirectory(atPath:trash.path)).count>=3 else { fail("expired notes missing from trash") } } catch { fail("cannot inspect trash") }
                                                                do { try Data("external change".utf8).write(to:NoteFiles.noteURL(app.storageURL.deletingLastPathComponent(),"a"),options:.atomic) } catch { fail("could not create save conflict") }
                                                                key(2,"d","d",.command)
                                                                DispatchQueue.main.asyncAfter(deadline:.now()+0.7) { [self] in
                                                                    app.web.evaluateJavaScript("[JSON.parse(window.exportNotesJSON()).notes.map(n=>n.content),document.querySelectorAll('.delete-notice').length,document.getElementById('save').classList.contains('error')]") { [self] value,error in
                                                                        guard error == nil,let result=value as? [Any],result[0] as? [String] == ["alpha"],result[1] as? Int == 0,result[2] as? Bool == true else { fail("failed save did not prevent deletion: \(String(describing:value))") }
                                                                        guard (try? String(contentsOf:NoteFiles.noteURL(app.storageURL.deletingLastPathComponent(),"a"),encoding:.utf8)) == "external change" else { fail("delete overwrote externally modified note") }
                                                                        print("PASS rapid delete, sequential shortcut undo, individual restore, original order, last note, 12 second expiry and save conflict")
                                                                        app.restoreInputSource();exit(0)
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                }
            }
        }
    }
    static func startVimBoundaries(_ app: AppDelegate) {
        running = NativeCodeEditingTest(app); app.showWindow()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { running?.testVimBoundaries() }
    }
    private func testVimBoundaries() {
        key(48, "\t"); later { [self] in
            app.web.evaluateJavaScript("[document.getElementById('mode').textContent,document.activeElement.classList.contains('cm-content')]") { [self] value,error in
                guard error == nil, let values=value as? [Any], values.count==2, values[0] as? String == "NORMAL", values[1] as? Bool == true else { fail("Tab changed normal mode or editor focus: \(String(describing:value))") }
                sequence([{ self.key(34,"i") }, { self.key(7,"x") }, { self.key(53,"\u{1b}") }]) { [self] in content { [self] text in
                    expect(text,"xabc","normal mode Tab leaves editor usable")
                    key(32,"u"); later { [self] in content { [self] text in
                        expect(text,"abc","undo after normal mode Tab")
                        testOpenPlainLines()

                    } }
                } }
            }
        }
    }
    private func testOpenPlainLines() {
        sequence([{ self.key(31,"o","o",.command) }, { self.key(7,"x") }, { self.key(53,"\u{1b}") }, { self.key(32,"u") }]) { [self] in content { [self] text in
            expect(text,"abc","undo line opened below plain text")
            key(15,"\u{12}","r",.control); later { [self] in content { [self] text in
                expect(text,"abc\nx","redo line opened below plain text")
                sequence([{ self.key(32,"u") }, { self.key(31,"O","o",[.command,.shift]) }, { self.key(16,"y") }, { self.key(53,"\u{1b}") }, { self.key(32,"u") }]) { [self] in content { [self] text in
                    expect(text,"abc","undo line opened above plain text")
                    key(15,"\u{12}","r",.control); later { [self] in content { [self] text in
                        expect(text,"y\nabc","redo line opened above plain text")
                        sequence([{ self.key(32,"u") }, { self.key(34,"i") }, { self.key(31,"o","o",.command) }, { self.key(8,"c") }, { self.key(53,"\u{1b}") }, { self.key(32,"u") }]) { [self] in content { [self] text in
                            expect(text,"abc","undo plain line opened in insert mode")
                            key(15,"\u{12}","r",.control); later { [self] in content { [self] text in
                                expect(text,"abc\nc","redo plain line opened in insert mode")
                                key(32,"u"); later { [self] in
                                    app.web.evaluateJavaScript("window.setVimEnabled(false)") { [self] _,error in
                                        guard error == nil else { fail("could not disable Vim for plain line test") }
                                        sequence([{ self.key(31,"o","o",.command) }, { self.key(6,"z") }, { self.key(6,"z","z",.command) }]) { [self] in content { [self] text in
                                            expect(text,"abc","undo plain line with Vim disabled")
                                            key(6,"Z","z",[.command,.shift]);later { [self] in content { [self] text in
                                                expect(text,"abc\nz","redo plain line with Vim disabled")
                                                app.web.evaluateJavaScript("window.setVimEnabled(true)") { [self] _,error in
                                                    guard error == nil else { fail("could not restore Vim") }
                                                    key(30,"]","]",.command); later { [self] in testTrailingBlank("list") }
                                                }
                                            } }
                                        } }
                                    }
                                }
                            } }
                        } }
                    } }
                } }
            } }
        } }
    }
    private func testTrailingBlank(_ mode: String) {
        let original=":::inkflit \(mode)\nfirst\n\n:::end", deleted=":::inkflit \(mode)\nfirst\n:::end"
        sequence([{ self.key(38,"j") }, { self.key(2,"d") }, { self.key(2,"d") }]) { [self] in content { [self] text in
            expect(text,deleted,"Vim dd removes trailing empty line in \(mode)")
            key(32,"u"); later { [self] in content { [self] text in
                expect(text,original,"Vim undo trailing empty line in \(mode)")
                key(15,"\u{12}","r",.control); later { [self] in content { [self] text in
                    expect(text,deleted,"Vim redo trailing empty line in \(mode)")
                    if mode == "list" { key(30,"]","]",.command); later { [self] in testTrailingBlank("code json") } }
                    else { print("PASS Vim Tab and block-boundary deletion"); app.restoreInputSource(); exit(0) }
                } }
            } }
        } }
    }
    static func startVimToggle(_ app: AppDelegate) {
        running = NativeCodeEditingTest(app); app.showWindow()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { running?.testVimToggle() }
    }
    private func testVimToggle() {
        if ProcessInfo.processInfo.environment["INKFLIT_VIM_RESTART_TEST"] == "1" {
            guard !app.vimEnabled() else { fail("disabled Vim preference was not restored") }
            key(0,"a"); later { [self] in content { [self] text in
                expect(text,"a","direct input after restarting with Vim disabled")
                print("PASS Vim preference restored at startup"); app.restoreInputSource(); exit(0)
            } }
            return
        }
        guard app.vimEnabled() else { fail("Vim must be enabled by default") }
        app.showSettings()
        guard let settings=app.settingsController else { fail("settings missing") }
        settings.testSelectSettingsTab(2)
        guard settings.testVimSwitchState() else { fail("Vim switch initial state") }
        guard settings.testEditingControlsVisible() else { fail("editing settings controls clipped") }
        settings.testToggleVim()
        guard !app.vimEnabled() && !settings.testVimSwitchState() else { fail("Vim preference not saved") }
        settings.window?.orderOut(nil); app.showWindow()
        later { [self] in
            sequence([{ self.key(0,"a") }, { self.key(11,"b") }]) { [self] in content { [self] text in
                expect(text,"ab","direct typing with Vim disabled")
                key(6,"z","z",.command); later { [self] in content { [self] text in
                    expect(text,"","standard undo with Vim disabled")
                    key(6,"Z","z",[.command,.shift]); later { [self] in content { [self] text in
                        expect(text,"ab","standard redo with Vim disabled")
                        key(30,"]","]",.command); later { [self] in
                            key(7,"x"); later { [self] in content { [self] text in
                                expect(text,"x","Vim setting survives note switch")
                                key(30,"]","]",.command); later { [self] in
                                    key(33,"{","[",.shift); later { [self] in content { [self] text in
                                        expect(text,":::inkflit code json\n{}\n:::end","code pairing with Vim disabled")
                                        key(33,"[","[",.command); later { [self] in
                                            app.showSettings(); settings.testToggleVim()
                                            guard app.vimEnabled() else { fail("Vim preference not enabled") }
                                            settings.window?.orderOut(nil); app.showWindow()
                                            later { [self] in
                                                key(34,"i"); key(8,"c"); key(53,"\u{1b}")
                                                later { [self] in content { [self] text in
                                                    expect(text,"xc","Vim insert mode after enabling")
                                                    key(32,"u"); later { [self] in content { [self] text in
                                                        expect(text,"x","Vim undo after enabling")
                                                        app.updateVimEnabled(false)
                                                        print("PASS native Vim settings toggle, editing and undo")
                                                        app.restoreInputSource(); exit(0)
                                                    } }
                                                } }
                                            }
                                        }
                                    } }
                                }
                            } }
                        }
                    } }
                } }
            } }
        }
    }
    static func startChecklist(_ app: AppDelegate) {
        running = NativeCodeEditingTest(app); app.showWindow()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { running?.testListIndentation(alreadySelected: true) }
    }
    static func testCursorColors(_ app: AppDelegate) {
        let script = """
        (() => {
          const host=document.createElement('div'); host.className='cm-editor cm-focused';
          const block=document.createElement('div'); block.className='cm-fat-cursor'; block.style.color='rgb(1, 2, 3)';
          const bar=document.createElement('div'); bar.className='cm-cursor'; host.append(block,bar); document.body.append(host);
          const errors=[];
          for(const theme of ['orange','blue','green']) {
            window.setUIAppearance(theme,100);
            const root=getComputedStyle(document.documentElement), probe=document.createElement('span'); document.body.append(probe);
            probe.style.color=root.getPropertyValue('--ui-cursor'); const cursor=getComputedStyle(probe).color;
            probe.style.color=root.getPropertyValue('--ui-paper'); const paper=getComputedStyle(probe).color; probe.remove();
            const b=getComputedStyle(block), c=getComputedStyle(bar);
            if(b.backgroundColor!==cursor || b.color!==paper || c.borderLeftColor!==cursor) errors.push(theme+': focused cursor mismatch');
            block.style.color='transparent'; if(getComputedStyle(block).color!=='rgba(0, 0, 0, 0)') errors.push(theme+': partial cursor text must stay transparent');
            block.style.color='rgb(1, 2, 3)';
            host.classList.remove('cm-focused'); const inactive=getComputedStyle(block);
            if(inactive.outlineColor!==cursor || inactive.backgroundColor!=='rgba(0, 0, 0, 0)') errors.push(theme+': inactive cursor mismatch');
            host.classList.add('cm-focused');
          }
          host.remove(); return errors;
        })()
        """
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            app.web.evaluateJavaScript(script) { result, error in
                guard error == nil, let errors = result as? [String], errors.isEmpty else {
                    fputs("FAIL native cursor colors: \(String(describing: error)) \(String(describing: result))\n", stderr); exit(1)
                }
                print("PASS native cursor colors for all three themes")
                app.restoreInputSource(); exit(0)
            }
        }
    }
    static func testTypography(_ app: AppDelegate) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            let script = """
            (() => {
              const errors=[], lines=[...document.querySelectorAll('.cm-content .cm-line')];
              const find=text=>lines.find(line=>line.textContent.trim()===text);
              const body=find('// body note'), inner=find('// list note'), code=find('// code note');
              if(!body?.classList.contains('cm-note-comment-body') || !body.querySelector('.cm-note-comment-marker')) errors.push('body annotation missing');
              if(inner?.classList.contains('cm-note-comment-body') || code?.classList.contains('cm-note-comment-body')) errors.push('block comment styled as body');
              const sizes=[1,2,3,4,5,6].map(n=>parseFloat(getComputedStyle(document.querySelector('.cm-note-heading-'+n)).fontSize));
              if(sizes.some((size,i)=>i && size>=sizes[i-1])) errors.push('heading levels do not descend: '+sizes);
              if(find('# code heading')?.classList.contains('cm-note-heading')) errors.push('code styled as heading');
              for(const theme of ['orange','blue','green']) {
                window.setUIAppearance(theme,100);
                const root=getComputedStyle(document.documentElement), probe=document.createElement('span'); document.body.append(probe);
                probe.style.color=root.getPropertyValue('--ui-accent'); const accent=getComputedStyle(probe).color;
                if(getComputedStyle(body.querySelector('.cm-note-comment-marker')).color!==accent) errors.push(theme+': comment marker color');
                const active=body.classList.contains('cm-activeLine');
                for(const selected of [false,true]) {
                  body.classList.toggle('cm-activeLine',selected);
                  probe.style.backgroundColor=`rgba(${root.getPropertyValue('--ui-bar-rgb')}, ${selected ? .9 : .65})`;
                  const style=getComputedStyle(body);
                  if(style.backgroundColor!==getComputedStyle(probe).backgroundColor) errors.push(theme+': comment background');
                  if(style.boxShadow!=='none' || parseFloat(style.paddingTop)<4 || parseFloat(style.paddingBottom)<4) errors.push(theme+': comment spacing or stripe');
                }
                body.classList.toggle('cm-activeLine',active); probe.remove();
              }
              return errors;
            })()
            """
            app.web.evaluateJavaScript(script) { result, error in
                guard error == nil, let errors = result as? [String], errors.isEmpty else {
                    fputs("FAIL native typography: \(String(describing: error)) \(String(describing: result))\n", stderr); exit(1)
                }
                print("PASS native headings and body comments across themes")
                app.restoreInputSource(); exit(0)
            }
        }
    }
    static func startTypographyVim(_ app: AppDelegate) {
        running = NativeCodeEditingTest(app); app.showWindow()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { running?.testTypographyVim(0) }
    }
    static func startCommentVim(_ app: AppDelegate) {
        running = NativeCodeEditingTest(app); app.showWindow()
        let theme = ProcessInfo.processInfo.environment["INKFLIT_TEST_UI_THEME"] ?? "orange"
        app.web.evaluateJavaScript("window.setUIAppearance('\(theme)',100)") { _, _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { running?.testCommentVim() }
        }
    }
    static func testCommentLayout(_ app: AppDelegate) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            let script = """
            (() => {
              const errors=[], lines=[...document.querySelectorAll('.cm-content .cm-line')];
              const find=text=>lines.find(line=>line.textContent.trim()===text);
              const a=find('// first'), b=find('// second'), c=find('// third'), d=find('// after code'), e=find('// next'), f=find('// after list');
              if([a,b,c,d,e,f].some(line=>!line?.classList.contains('cm-note-comment-body'))) return ['missing body comments'];
              const inside=find('// inside list'), source=find('// code comment');
              if(inside?.classList.contains('cm-note-comment-body') || source?.classList.contains('cm-note-comment-body')) errors.push('feature comment styled as body');
              for(const theme of ['orange','blue','green']) {
                window.setUIAppearance(theme,100);
                for(const group of [[a,b,c],[d,e]]) {
                  group.forEach((line,index)=>{
                    const style=getComputedStyle(line), first=index===0, last=index===group.length-1;
                    if(parseFloat(style.borderTopLeftRadius)!==(first?6:0) || parseFloat(style.borderBottomLeftRadius)!==(last?6:0)) errors.push(theme+': incorrect group corners');
                    if(parseFloat(style.paddingTop)!==(first?4:1) || parseFloat(style.paddingBottom)!==(last?4:1)) errors.push(theme+': incorrect group padding');
                    if(index && Math.abs(line.getBoundingClientRect().top-group[index-1].getBoundingClientRect().bottom)>0.5) errors.push(theme+': comment background gap');
                  });
                }
                const single=getComputedStyle(f);
                if(parseFloat(single.borderTopLeftRadius)!==6 || parseFloat(single.borderBottomLeftRadius)!==6) errors.push(theme+': isolated comment corners');
                const codeHeader=lines.find(line=>line.querySelector('.block-type')?.textContent.includes('代码') || line.querySelector('.block-type')?.textContent.includes('Code')) || document.querySelector('.cm-block-header-line');
                const headers=[...document.querySelectorAll('.cm-block-header-line')];
                const button=headers[0]?.querySelector('.block-type');
                if(!codeHeader || !button || button.getBoundingClientRect().top-c.getBoundingClientRect().bottom<8) errors.push(theme+': comment touches block header');
                const ends=[...document.querySelectorAll('.cm-block-end-line .block-end')];
                if(ends.length!==2 || d.getBoundingClientRect().top-ends[0].getBoundingClientRect().bottom<8 || f.getBoundingClientRect().top-ends[1].getBoundingClientRect().bottom<8) errors.push(theme+': comment touches block end');
              }
              return errors;
            })()
            """
            app.web.evaluateJavaScript(script) { result, error in
                guard error == nil, let errors = result as? [String], errors.isEmpty else {
                    fputs("FAIL native comment layout: \(String(describing: error)) \(String(describing: result))\n", stderr); exit(1)
                }
                print("PASS grouped comments, isolated comments and adjacent feature blocks across themes")
                app.restoreInputSource(); exit(0)
            }
        }
    }
    static func startCommentGroupVim(_ app: AppDelegate) {
        running = NativeCodeEditingTest(app); app.showWindow()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { running?.testCommentGroupVim() }
    }
    static func startBlockBoundary(_ app: AppDelegate) {
        running = NativeCodeEditingTest(app); app.showWindow()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { running?.testBlockBoundary() }
    }
    static func startPlainText(_ app: AppDelegate) {
        running = NativeCodeEditingTest(app); app.showWindow()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { running?.testPlainText() }
    }
    private func testPlainText() {
        key(40, "k", "k", .command); later { [self] in
            app.web.evaluateJavaScript("(() => { const item=[...document.querySelectorAll('.block-menu-item')].find(x=>x.querySelector('kbd')?.textContent==='text'); if(!item)return false; item.click(); return true; })()") { [self] value, error in
                guard error == nil, value as? Bool == true else { fail("convert to text action missing") }
                later { [self] in content { [self] text in
                    expect(text, "12", "convert block to plain text")
                    key(32, "u"); later { [self] in content { [self] text in
                        expect(text, ":::inkflit sum\n12\n:::end", "undo convert to text")
                        key(15, "\u{12}", "r", .control); later { [self] in content { [self] text in
                            expect(text, "12", "redo convert to text")
                            sequence([{ self.key(30, "]", "]", .command) }, { self.key(34, "i") }, { self.key(44, "/") }]) { [self] in
                                app.web.evaluateJavaScript("(() => { const menu=document.querySelector('#block-menu'); return {hidden:menu.hidden, ids:[...menu.querySelectorAll('kbd')].map(x=>x.textContent), text:document.querySelector('.cm-activeLine')?.textContent, mode:document.querySelector('#mode')?.textContent}; })()") { [self] value, error in
                                    guard error == nil, let info = value as? [String:Any], let hidden=info["hidden"] as? Bool, !hidden,
                                          let ids=info["ids"] as? [String], ids.contains("sum"), !ids.contains("text") else { fail("slash menu contents: \(String(describing: value))") }
                                    print("PASS slash menu and undoable block-to-text conversion")
                                    app.restoreInputSource(); exit(0)
                                }
                            }
                        } }
                    } }
                } }
            }
        }
    }
    private func activeLine(_ completion: @escaping (String) -> Void) {
        app.web.evaluateJavaScript("(() => { const line=document.querySelector('.cm-activeLine'); return line ? JSON.stringify({text:line.textContent,classes:line.className}) : null; })()") { [self] value, error in
            guard error == nil, let result = value as? String else { fail("could not inspect active line") }
            completion(result)
        }
    }
    private func testBlockBoundary() {
        sequence([{ self.key(5, "G", "g", .shift) }, { self.key(34, "i") }, { self.key(126, "\u{f700}") }]) { [self] in
            activeLine { [self] line in
                guard !line.contains("cm-block-end-line") && !line.contains("calculation-result") else { fail("arrow up selected the result line") }
                key(125, "\u{f701}"); later { [self] in activeLine { [self] next in
                    guard next.contains("plain") && !next.contains("cm-block-header-line") else { fail("arrow down did not reach the next block: \(next)") }
                sequence([{ self.key(53, "\u{1b}") }, { self.key(30, "]", "]", .command) }, { self.key(0, "A", "a", .shift) }, { self.key(36, "\r") }]) { [self] in
                    content { [self] text in
                        let expected = ":::inkflit sum\n12\n\n:::end"
                        expect(text, expected, "Return after nonempty final block line")
                        key(36, "\r"); later { [self] in content { [self] value in
                            expect(value, expected + "\n", "Return on final blank line exits block")
                            print("PASS block boundary navigation and Return")
                            app.restoreInputSource(); exit(0)
                        } }
                    }
                }
                } }
            }
        }
    }
    private func testCommentGroupVim() {
        let original = "// first\n// second\n// third\n:::inkflit code js\n// code comment\nconst x = 3;\n:::end\n// after code\n// next\n:::inkflit list\n// inside list\napple\n:::end\n// after list"
        let changed = original.replacingOccurrences(of: "// second", with: "// secondx")
        sequence([{ self.key(38, "j") }, { self.key(0, "A", "a", .shift) }, { self.key(7, "x") }, { self.key(53, "\u{1b}") }]) { [self] in
            content { [self] text in
                expect(text, changed, "Vim edit inside grouped comments")
                key(32, "u"); later { [self] in content { [self] text in
                    expect(text, original, "Vim undo inside grouped comments")
                    key(15, "\u{12}", "r", .control); later { [self] in content { [self] text in
                        expect(text, changed, "Vim redo inside grouped comments")
                        sequence([{ self.key(38, "j") }, { self.key(38, "j") }]) { [self] in
                            app.web.evaluateJavaScript("document.querySelector('.cm-activeLine')?.textContent.trim()") { [self] value, error in
                                guard error == nil, value as? String == "// code comment" else { fail("Vim movement from comments into feature block: \(String(describing: value))") }
                                print("PASS Vim movement from grouped comments into adjacent code block")
                                app.restoreInputSource(); exit(0)
                            }
                        }
                    } }
                } }
            }
        }
    }
    private func checkCommentCursor(_ mode: String, completion: @escaping () -> Void) {
        let script = """
        (() => {
          const root=getComputedStyle(document.documentElement), probe=document.createElement('span'); document.body.append(probe);
          probe.style.color=root.getPropertyValue('--ui-cursor'); const expected=getComputedStyle(probe).color; probe.remove();
          const normal='\(mode)'==='normal', line=document.querySelector('.cm-note-comment-body.cm-activeLine');
          const cursor=document.querySelector(normal ? '.cm-fat-cursor' : '.cm-cursorLayer:not(.cm-vimCursorLayer) .cm-cursor-primary');
          if(!line || !cursor || !document.querySelector('.cm-editor.cm-focused')) return false;
          const style=getComputedStyle(cursor), box=cursor.getBoundingClientRect();
          return box.height>0 && (normal ? style.backgroundColor : style.borderLeftColor)===expected;
        })()
        """
        app.web.evaluateJavaScript(script) { [self] result, error in
            guard error == nil, result as? Bool == true else { fail("comment cursor mismatch in \(mode): \(String(describing: error))") }
            completion()
        }
    }
    private func testCommentVim() {
        checkCommentCursor("normal") { [self] in
            key(0, "A", "a", .shift); later { [self] in
                checkCommentCursor("insert") { [self] in
                    sequence([{ self.key(7, "x") }, { self.key(53, "\u{1b}") }]) { [self] in
                        content { [self] text in
                            expect(text, "// body notex", "comment insert")
                            checkCommentCursor("normal") { [self] in
                                key(32, "u"); later { [self] in content { [self] text in
                                    expect(text, "// body note", "comment undo")
                                    key(15, "\u{12}", "r", .control); later { [self] in content { [self] text in
                                        expect(text, "// body notex", "comment redo")
                                        print("PASS comment Vim cursors, edit, undo and redo")
                                        app.restoreInputSource(); exit(0)
                                    } }
                                } }
                            }
                        }
                    }
                }
            }
        }
    }
    static func startFileStorage(_ app: AppDelegate) {
        running = NativeCodeEditingTest(app); app.showWindow()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { running?.testFileStorage() }
    }
    static func startAutosave(_ app: AppDelegate) {
        running = NativeCodeEditingTest(app); app.showWindow()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { running?.testAutosave() }
    }
    static func startOnboarding(_ app: AppDelegate) {
        running = NativeCodeEditingTest(app); app.showWindow()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { running?.testOnboarding() }
    }
    static func startReadingNavigation(_ app: AppDelegate) {
        running = NativeCodeEditingTest(app); app.showWindow()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { running?.testReadingAndNavigation() }
    }
    private func testReadingAndNavigation() {
        let script = """
        (() => {
          const errors=[], root=document.documentElement, lines=[...document.querySelectorAll('.cm-content .cm-line')];
          const shortcut=lines.find(line=>line.textContent.includes('⌘[ / ⌘]'));
          const formatting=lines.find(line=>line.textContent.includes('**粗體**'));
          const markers=[...(shortcut?.querySelectorAll('.tok-meta')||[]),...(formatting?.querySelectorAll('.tok-meta')||[])];
          const url=formatting?.querySelector('.tok-url');
          if(markers.length<4 || !url) return ['Markdown markers or link missing'];
          const color=value=>{const p=document.createElement('span');p.style.color=value;document.body.append(p);const c=getComputedStyle(p).color;p.remove();return c};
          const luminance=value=>{const v=value.match(/\\d+(?:\\.\\d+)?/g).slice(0,3).map(x=>Number(x)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return v[0]*.2126+v[1]*.7152+v[2]*.0722};
          for(const theme of ['orange','blue','green']) {
            window.setUIAppearance(theme,100); const style=getComputedStyle(root), fg=color(style.getPropertyValue('--ui-button')), bg=color(style.getPropertyValue('--ui-paper'));
            const a=luminance(fg),b=luminance(bg);if((Math.max(a,b)+.05)/(Math.min(a,b)+.05)<4.5) errors.push(theme+': insufficient contrast');
            for(const marker of [...markers,url]) if(getComputedStyle(marker).color!==fg) errors.push(theme+': unreadable Markdown marker '+marker.textContent);
            const token=lines.find(line=>line.textContent.includes('"value"'))?.querySelector('.tok-string');
            if(!token || getComputedStyle(token).color!==color(style.getPropertyValue('--syntax-string'))) errors.push(theme+': code string color changed');
          }
          const p=document.getElementById('previous'),n=document.getElementById('next');
          if(!p.disabled || n.disabled || document.getElementById('position').textContent!=='1 / 3')errors.push('initial navigation');
          if(!p.title.includes('⌘[') || !n.title.includes('⌘]'))errors.push('navigation shortcuts');
          return errors;
        })()
        """
        app.web.evaluateJavaScript(script) { [self] value, error in
            guard error == nil, let errors=value as? [String], errors.isEmpty else { fail("Markdown appearance: \(String(describing: error)) \(String(describing: value))") }
            print("PASS Markdown marker contrast and code highlighting across themes")
            key(30, "]", "]", .command); later { [self] in checkNavigation("second", "2 / 3", false, false) { [self] in
                key(30, "]", "]", .command); later { [self] in checkNavigation("third", "3 / 3", false, true) { [self] in
                    key(33, "[", "[", .command); later { [self] in checkNavigation("second", "2 / 3", false, false) { [self] in
                        app.web.evaluateJavaScript("document.getElementById('previous').click()") { [self] _, error in
                            guard error == nil else { fail("could not click previous") }
                            later { [self] in checkNavigation("first", "1 / 3", true, false) { [self] in
                                app.web.evaluateJavaScript("document.getElementById('next').click()") { [self] _, error in
                                    guard error == nil else { fail("could not click next") }
                                    later { [self] in checkNavigation("second", "2 / 3", false, false) { [self] in
                                        key(18, "1", "1", .command); later { [self] in checkNavigation("first", "1 / 3", true, false) { [self] in
                                            key(30, "}", "}", [.command, .shift]); later { [self] in checkNavigation("third", "3 / 3", false, true) { [self] in
                                                key(33, "{", "{", [.command, .shift]); later { [self] in checkNavigation("first", "1 / 3", true, false) { [self] in
                                                    print("PASS arrow buttons and Cmd bracket navigation follow page order")
                                                    print("PASS Cmd-Shift brackets jump to the first and last note")
                                                    app.restoreInputSource(); exit(0)
                                                } }
                                            } }
                                        } }
                                    } }
                                }
                            } }
                        }
                    } }
                } }
            } }
        }
    }
    private func checkNavigation(_ selected: String, _ position: String, _ previousDisabled: Bool, _ nextDisabled: Bool, completion: @escaping () -> Void) {
        let script = "(() => { const s=JSON.parse(window.exportNotesJSON()); return [s.selected,document.getElementById('position').textContent,document.getElementById('previous').disabled,document.getElementById('next').disabled]; })()"
        app.web.evaluateJavaScript(script) { [self] value, error in
            guard error == nil, let info=value as? [Any], info.count == 4, info[0] as? String == selected,
                  info[1] as? String == position, info[2] as? Bool == previousDisabled, info[3] as? Bool == nextDisabled else { fail("navigation state: \(String(describing: value))") }
            completion()
        }
    }
    private func testOnboarding() {
        let systemLanguage = ProcessInfo.processInfo.environment["INKFLIT_TEST_SYSTEM_LANGUAGE"] ?? "en"
        let expected = ProcessInfo.processInfo.environment["INKFLIT_TEST_EXPECT_LANGUAGE"] ?? Localization.resolve([systemLanguage])
        do {
            let snapshot = try NoteFiles.read(app.storageURL.deletingLastPathComponent())
            let contents = try Onboarding.contents(language: expected)
            guard snapshot.notes.map(\.content) == contents, snapshot.selected == snapshot.notes.first?.id else { fail("first run did not create the system-language guides") }
        } catch { fail("could not read first-run guides: \(error)") }
        print("PASS first-run guide language \(expected)")
        if ProcessInfo.processInfo.environment["INKFLIT_ONBOARDING_LOCALE_ONLY"] == "1" { app.restoreInputSource(); exit(0) }
        testOnboardingConflictAndCreate()
    }
    private func testOnboardingConflictAndCreate() {
        let directory = app.storageURL.deletingLastPathComponent()
        let snapshot: NoteSnapshot
        do { snapshot = try NoteFiles.read(directory) } catch { fail("could not read guide fixture") }
        let first = NoteFiles.noteURL(directory, snapshot.notes[0].id), original = Data(snapshot.notes[0].content.utf8)
        do { try Data("external change".utf8).write(to: first, options: .atomic) } catch { fail("could not create guide conflict") }
        app.generateOnboarding { [self] error in
            guard error != nil, (try? String(contentsOf: first, encoding: .utf8)) == "external change" else { fail("guide generation overwrote an external change") }
            app.web.evaluateJavaScript("JSON.parse(window.exportNotesJSON()).notes.length") { [self] value, error in
                guard error == nil, (value as? NSNumber)?.intValue == guideCount else { fail("failed guide generation changed the editor") }
                do { try original.write(to: first, options: .atomic) } catch { fail("could not restore guide fixture") }
                print("PASS guide regeneration preserves external changes")
                createOnboardingUserNote()
            }
        }
    }
    private var guideCount: Int { (try? Onboarding.contents(language: Localization.current).count) ?? 0 }
    private func createOnboardingUserNote() {
        app.web.evaluateJavaScript("window.confirm=()=>true; document.getElementById('new').click()") { [self] _, error in
            guard error == nil else { fail("could not create user note") }
            later { [self] in
                sequence([{ self.key(34, "i") }, { self.key(32, "u") }, { self.key(53, "\u{1b}") }]) { [self] in
                    app.requestFlush { [self] success, _ in
                        guard success else { fail("could not save user note") }
                        do {
                            let snapshot = try NoteFiles.read(app.storageURL.deletingLastPathComponent())
                            // New notes go last; ⌘1 returns to the first guide before deleting the guides.
                            guard let user = snapshot.notes.last, user.content == "u", snapshot.notes.count == guideCount + 1 else { fail("user note missing") }
                            key(18, "1", "1", .command)
                            later { [self] in deleteGuideNotes(guideCount, user: user) }
                        } catch { fail("could not read user note: \(error)") }
                    }
                }
            }
        }
    }
    static func testOnboardingCollision(_ app: AppDelegate) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            app.web.evaluateJavaScript("document.querySelector('#save').classList.contains('error')") { value, error in
                let directory = app.storageURL.deletingLastPathComponent()
                let sentinel = directory.appendingPathComponent("notes/existing.md")
                guard error == nil, value as? Bool == true,
                      (try? String(contentsOf: sentinel, encoding: .utf8)) == "existing data",
                      !FileManager.default.fileExists(atPath: NoteFiles.index(directory).path) else {
                    fputs("FAIL onboarding initialization overwrote or hid an existing-data conflict\n", stderr); exit(1)
                }
                print("PASS onboarding refuses to overwrite existing data")
                app.restoreInputSource(); exit(0)
            }
        }
    }
    private func waitForNoteCount(_ expected: Int, attempts: Int = 20, completion: @escaping () -> Void) {
        app.web.evaluateJavaScript("JSON.parse(window.exportNotesJSON()).notes.length") { [self] value, error in
            guard error == nil else { fail("could not inspect note count") }
            if (value as? NSNumber)?.intValue == expected { completion(); return }
            guard attempts > 0 else { fail("note count did not reach \(expected)") }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [self] in waitForNoteCount(expected, attempts: attempts-1, completion: completion) }
        }
    }
    private func deleteGuideNotes(_ remaining: Int, user: StoredNote) {
        if remaining == 0 {
            do {
                let snapshot = try NoteFiles.read(app.storageURL.deletingLastPathComponent())
                guard snapshot.notes == [user], snapshot.selected == user.id else { fail("deleting guides changed the user note") }
            } catch { fail("could not inspect remaining note: \(error)") }
            app.web.evaluateJavaScript("document.getElementById('new').click()") { [self] _, error in
                guard error == nil else { fail("could not create a second user note") }
                later { [self] in
                    sequence([{ self.key(34, "i") }, { self.key(9, "v") }, { self.key(53, "\u{1b}") }]) { [self] in
                        app.requestFlush { [self] success, _ in
                            guard success else { fail("could not save second user note") }
                            do {
                                let users = try NoteFiles.read(app.storageURL.deletingLastPathComponent()).notes
                                guard users.count == 2, users[0] == user, users[1].content == "v" else { fail("second user note missing") }
                                regenerateGuides(before: users)
                            } catch { fail("could not inspect existing notes: \(error)") }
                        }
                    }
                }
            }
            return
        }
        app.web.evaluateJavaScript("document.getElementById('delete').click()") { [self] _, error in
            guard error == nil else { fail("could not delete guide") }
            waitForNoteCount(remaining) { [self] in
                app.requestFlush { [self] success, _ in
                    guard success else { fail("could not save guide deletion") }
                    deleteGuideNotes(remaining-1, user: user)
                }
            }
        }
    }
    private func regenerateGuides(before users: [StoredNote]) {
        app.showSettings()
        guard let settings = app.settingsController, settings.testGenerateOnboarding() else { fail("guide settings button missing or clipped") }
        waitForNoteCount(guideCount + users.count) { [self] in
            app.requestFlush { [self] success, _ in
                    guard success else { fail("regenerated guides were not saved") }
                    do {
                        let snapshot = try NoteFiles.read(app.storageURL.deletingLastPathComponent())
                        let guides = try Onboarding.contents(language: Localization.current)
                        guard snapshot.notes.count == guides.count + users.count, Array(snapshot.notes.prefix(guides.count)).map(\.content) == guides,
                              Array(snapshot.notes.suffix(users.count)) == users, snapshot.selected == snapshot.notes.first?.id else { fail("regenerated guides were not placed before existing user notes") }
                    } catch { fail("could not inspect regenerated guides: \(error)") }
                    print("PASS guide deletion and regeneration before existing notes")
                    app.restoreInputSource(); exit(0)
            }
        }
    }
    static func startAutosaveStream(_ app: AppDelegate) {
        running = NativeCodeEditingTest(app); app.showWindow()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { running?.key(34, "i"); running?.streamStartedAt = ProcessInfo.processInfo.systemUptime; running?.testAutosaveStream(0) }
    }
    private func testAutosaveStream(_ index: Int) {
        if index == 15 {
            guard let first = app.testSaveTimes.first, first - streamStartedAt <= 2.35 else { fail("continuous typing exceeded the maximum save delay") }
            app.requestFlush { [self] success, _ in
                guard success else { fail("continuous typing final flush failed") }
                do { guard try NoteFiles.read(app.storageURL.deletingLastPathComponent()).notes[0].content == String(repeating:"x",count:15) + "one" else { fail("continuous typing content lost") } }
                catch { fail("could not read continuous typing save: \(error)") }
                print("PASS continuous typing is saved within the maximum delay")
                app.restoreInputSource(); exit(0)
            }
            return
        }
        key(7, "x")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) { [self] in testAutosaveStream(index + 1) }
    }
    private func testAutosave() {
        let directory = app.storageURL.deletingLastPathComponent()
        sequence([{ self.key(34, "i") }, { self.key(0, "a") }, { self.key(11, "b") }, { self.key(8, "c") }]) { [self] in
            guard app.testSuccessfulSaves == 0 else { fail("burst wrote before the debounce interval") }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [self] in
                do { guard app.testSuccessfulSaves == 1, try NoteFiles.read(directory).notes[0].content == "abcone" else { fail("burst was not coalesced into one save") } }
                catch { fail("could not read burst save: \(error)") }
                app.web.evaluateJavaScript("document.querySelector('#save').textContent") { [self] value, error in
                    guard error == nil, value as? String == "" else { fail("successful save status should be hidden") }
                    sequence([{ self.key(2, "d") }, { self.key(30, "]", "]", .command) }]) { [self] in
                        do { let saved=try NoteFiles.read(directory); guard app.testSuccessfulSaves == 2, saved.notes[0].content == "abcdone", saved.selected == "second" else { fail("switch did not flush the previous note") } }
                        catch { fail("could not read switch save: \(error)") }
                        sequence([{ self.key(34, "i") }, { self.key(7, "x") }]) { [self] in
                            app.hideWindow()
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [self] in
                                do { guard !app.window.isVisible, try NoteFiles.read(directory).notes[1].content == "xtwo" else { fail("hide did not flush the current note") } }
                                catch { fail("could not read hide save: \(error)") }
                                app.showWindow(); testAutosaveFailureAndExit(directory)
                            }
                        }
                    }
                }
            }
        }
    }
    private func testAutosaveFailureAndExit(_ directory: URL) {
        let first = NoteFiles.noteURL(directory, "first")
        do { try Data("external".utf8).write(to: first, options: .atomic) } catch { fail("could not create conflict fixture") }
        sequence([{ self.key(16, "y") }]) { [self] in
            app.requestFlush { [self] success, _ in
                guard !success, (try? String(contentsOf: first, encoding: .utf8)) == "external" else { fail("external edit was overwritten") }
                app.web.evaluateJavaScript("window.confirm=()=>true; document.getElementById('delete').click()") { [self] _, error in
                guard error == nil else { fail("could not request delete during failed save") }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [self] in
                    content { [self] text in
                    expect(text, "xytwo", "failed save prevents deletion")
                    app.web.evaluateJavaScript("document.querySelector('#save').classList.contains('error')") { [self] result, error in
                        guard error == nil, result as? Bool == true else { fail("save failure not visible") }
                        NSApp.terminate(nil)
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [self] in
                            guard app.window.isVisible else { fail("failed quit did not keep the note visible") }
                            guard app.testSaveRetryScheduled else { fail("failed save scheduled no automatic retry") }
                            do { try Data("abcdone".utf8).write(to: first, options: .atomic) } catch { fail("could not restore conflict fixture") }
                            app.requestFlush { [self] success, _ in
                                guard success else { fail("failed save did not retry") }
                                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [self] in
                                    app.web.evaluateJavaScript("document.querySelector('#save').textContent") { [self] value, error in
                                        guard error == nil, value as? String == "" else { fail("error did not clear after successful retry") }
                                        print("PASS debounce, switch, hide, conflict and failed-quit recovery")
                                        key(6, "z")
                                        NSApp.terminate(nil)
                                    }
                                }
                            }
                        }
                    }
                    }
                }
                }
            }
        }
    }
    private func testFileStorage() {
        let directory = app.storageURL.deletingLastPathComponent()
        sequence([{ self.key(0, "A", "a", .shift) }, { self.key(7, "x") }, { self.key(53, "\u{1b}") }]) { [self] in
            content { [self] text in
                expect(text, "firstx", "native per-note edit")
                guard app.testSuccessfulSaves == 0 else { fail("delete test missed the pending-save window") }
                app.web.evaluateJavaScript("window.confirm=()=>true; document.getElementById('delete').click()") { [self] _, error in
                    if let error { fail("native delete: \(error)") }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [self] in
                        do {
                            let folder = directory.appendingPathComponent("trash").appendingPathComponent(String(NoteFiles.filename("first").dropLast(3)))
                            let items = try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
                            guard items.count == 1, let value = try? Data(contentsOf: items[0]), String(data: value, encoding: .utf8) == "firstx" else { fail("deleted note missing from trash") }
                            app.web.evaluateJavaScript("window.restoreNoteBase64('\(value.base64EncodedString())')") { [self] _, error in
                                if let error { fail("native restore: \(error)") }
                                later { [self] in content { [self] text in
                                    expect(text, "firstx", "native trash restore")
                                    do { guard try NoteFiles.read(directory).notes.last?.content == "firstx", FileManager.default.fileExists(atPath: items[0].path) else { fail("restore not saved or removed trash") } }
                                    catch { fail("restored storage: \(error)") }
                                    testStorageLocation(directory)
                                } }
                            }
                        } catch { fail("native trash: \(error)") }
                    }
                }
            }
        }
    }
    private func testStorageLocation(_ source: URL) {
        let files = FileManager.default, parent = source.deletingLastPathComponent()
        let destination = parent.appendingPathComponent("moved"), conflict = parent.appendingPathComponent("conflict")
        do {
            try files.createDirectory(at: conflict, withIntermediateDirectories: true)
            try Data("do not overwrite".utf8).write(to: NoteFiles.index(conflict))
        } catch { fail("could not create conflict fixture: \(error)") }
        app.changeStorageDirectory(conflict) { [self] error in
            guard error != nil, app.storageURL.deletingLastPathComponent() == source,
                  (try? Data(contentsOf: NoteFiles.index(conflict))) == Data("do not overwrite".utf8) else { fail("conflicting location was overwritten or selected") }
            let index = NoteFiles.index(source), missing = source.appendingPathComponent("index.temporarily-removed")
            do { try files.moveItem(at: index, to: missing) } catch { fail("could not simulate unavailable index") }
            app.changeStorageDirectory(destination) { [self] error in
                do { try files.moveItem(at: missing, to: index) } catch { fail("could not restore test index") }
                guard error != nil, app.storageURL.deletingLastPathComponent() == source,
                      !files.fileExists(atPath: NoteFiles.index(destination).path) else { fail("missing source index accepted") }
                app.changeStorageDirectory(destination) { [self] error in
                    guard error == nil, app.storageURL.deletingLastPathComponent().standardizedFileURL.path == destination.standardizedFileURL.path else { fail("could not move storage: \(String(describing: error))") }
                    do {
                        let old = try NoteFiles.read(source), new = try NoteFiles.read(destination)
                        guard old == new,
                              try files.contentsOfDirectory(atPath: destination.appendingPathComponent("backups").path).count > 0,
                              try files.contentsOfDirectory(atPath: destination.appendingPathComponent("trash").path).count > 0 else { fail("location copy lost notes, backups or trash") }
                    } catch { fail("location verification: \(error)") }
                    sequence([{ self.key(0, "A", "a", .shift) }, { self.key(7, "x") }, { self.key(53, "\u{1b}") }]) { [self] in
                        content { [self] text in
                            expect(text, "firstxx", "native edit after changing location")
                            app.requestFlush { [self] success, _ in
                            guard success else { fail("could not flush changed location") }
                            do {
                                // The restored note is the last one and still selected.
                                guard try NoteFiles.read(source).notes.last?.content == "firstx",
                                      try NoteFiles.read(destination).notes.last?.content == "firstxx" else { fail("edit went to wrong location") }
                            } catch { fail("could not read moved notes: \(error)") }
                            app.showSettings()
                            guard let settings = app.settingsController, settings.testBackupControls() else { fail("backup settings or recovery controls") }
                            print("PASS native location switch, conflict and missing source protection")
                            print("PASS native backup settings and recovery control layout")
                            print("PASS native edit, delete and restore")
                            app.restoreInputSource(); exit(0)
                            }
                        }
                    }
                }
            }
        }
    }
    private func testTypographyVim(_ index: Int) {
        let lines = ["// body note", "# One", "## Two", "### Three", "#### Four", "##### Five", "###### Six"]
        if index == lines.count { print("PASS native Vim edits and undo/redo on comments and all heading levels"); app.restoreInputSource(); exit(0) }
        let original = lines.joined(separator: "\n")
        let changed = lines.enumerated().map { $0.offset == index ? $0.element + "x" : $0.element }.joined(separator: "\n")
        sequence([{ self.key(0, "A", "a", .shift) }, { self.key(7, "x") }, { self.key(53, "\u{1b}") }]) { [self] in
            content { [self] text in
                expect(text, changed, "Vim edit line \(index)")
                let selector = index == 0 ? ".cm-note-comment-body .cm-note-comment-marker" : ".cm-note-heading-\(index)"
                app.web.evaluateJavaScript("!!document.querySelector('\(selector)')") { [self] result, error in
                    guard error == nil, result as? Bool == true else { fail("typography disappeared while editing line \(index)") }
                    key(32, "u"); later { [self] in content { [self] text in
                        expect(text, original, "Vim undo line \(index)")
                        key(15, "\u{12}", "r", .control); later { [self] in content { [self] text in
                            expect(text, changed, "Vim redo line \(index)")
                            key(32, "u"); later { [self] in content { [self] text in
                                expect(text, original, "Vim restore line \(index)")
                                if index < lines.count - 1 { key(38, "j") }
                                later { [self] in testTypographyVim(index + 1) }
                            } }
                        } }
                    } }
                }
            }
        }
    }
    private func fail(_ message: String) -> Never { app.restoreInputSource(); fputs("FAIL: \(message)\n", stderr); exit(1) }
    private func key(_ code: UInt16, _ text: String, _ unmodified: String? = nil, _ flags: NSEvent.ModifierFlags = []) {
        for type in [NSEvent.EventType.keyDown, .keyUp] {
            guard let event = NSEvent.keyEvent(with: type, location: .zero, modifierFlags: flags, timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: app.window.windowNumber, context: nil, characters: text, charactersIgnoringModifiers: unmodified ?? text, isARepeat: false, keyCode: code) else { fail("could not create keyboard event") }
            app.window.sendEvent(event)
        }
    }
    private func later(_ block: @escaping () -> Void) { DispatchQueue.main.asyncAfter(deadline: .now() + 0.15, execute: block) }
    private func sequence(_ actions: [() -> Void], _ completion: @escaping () -> Void) {
        guard let first = actions.first else { later(completion); return }
        first()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) { [self] in sequence(Array(actions.dropFirst()), completion) }
    }
    private func content(_ block: @escaping (String) -> Void) {
        app.web.evaluateJavaScript("window.exportNotesJSON?.()") { [self] result, error in
            guard error == nil, let json = result as? String, let data = json.data(using: .utf8),
                  let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let notes = object["notes"] as? [[String: Any]], let selected = object["selected"] as? String,
                  let note = notes.first(where: { ($0["id"] as? String) == selected }),
                  let text = note["content"] as? String else { fail("could not read isolated note") }
            block(text)
        }
    }
    private func expect(_ actual: String, _ expected: String, _ label: String) {
        if actual != expected { fail("\(label): expected \(String(reflecting: expected)), got \(String(reflecting: actual))") }
        print("PASS \(label)")
    }
    private func run() {
        app.showWindow()
        if app.web.isOpaque { fail("WebKit view is opaque") }
        if app.web.responds(to: NSSelectorFromString("_setDrawsBackground:")) && (app.web.value(forKey: "drawsBackground") as? Bool) != false { fail("WebKit still draws an opaque page background") }
        if abs(app.window.frame.width * 3 - app.window.frame.height * 2) > 2 { fail("default window is not 2:3") }
        print("PASS native default window aspect ratio")
        guard let root = app.window.contentView,
              root.hitTest(NSPoint(x: root.bounds.midX, y: root.bounds.maxY - 5)) is WindowDragView,
              root.hitTest(NSPoint(x: root.bounds.midX, y: root.bounds.maxY - 28)) is WindowDragView,
              !(root.hitTest(NSPoint(x: 30, y: root.bounds.maxY - 28)) is WindowDragView),
              !(root.hitTest(NSPoint(x: root.bounds.maxX - 30, y: root.bounds.maxY - 28)) is WindowDragView) else { fail("drag areas or toolbar hit testing incorrect") }
        print("PASS native drag and toolbar hit testing")
        app.web.evaluateJavaScript("window.focusEditor?.()") { [self] _, _ in
            later { [self] in
                sequence([{ self.key(34, "i") }, { self.key(33, "{", "[", .shift) }]) { [self] in content { [self] text in
                    expect(text, ":::inkflit code json\n{}\n:::end", "native brace pair")
                    key(36, "\r")
                    later { [self] in content { [self] text in
                        expect(text, ":::inkflit code json\n{\n\(unit)\n}\n:::end", "native indentation")
                        sequence([{ self.key(39, "\"", "'", .shift) }, { self.key(40, "k") }, { self.key(14, "e") }, { self.key(16, "y") }, { self.key(39, "\"", "'", .shift) }, { self.key(41, ":", ";", .shift) }, { self.key(49, " ") }, { self.key(18, "1") }]) { [self] in content { [self] text in
                            completedText = ":::inkflit code json\n{\n\(unit)\"key\": 1\n}\n:::end"
                            expect(text, completedText, "native quote pair and closer")
                            sequence([{ self.key(53, "\u{1b}") }, { self.key(32, "u") }]) { [self] in content { [self] undone in
                                if undone == completedText { fail("Vim undo did not change the note") }
                                print("PASS native Vim undo")
                                key(15, "\u{12}", "r", .control)
                                later { [self] in content { [self] redone in
                                    expect(redone, completedText, "native Vim redo")
                                    testPairDeletionAndTab()
                                } }
                            } }
                        } }
                    } }
                } }
            }
        }
    }
    private func testPairDeletionAndTab() {
        sequence([{ self.key(30, "]", "]", .command) }, { self.key(34, "i") }, { self.key(33, "[") }, { self.key(51, "\u{7f}") }]) { [self] in content { [self] text in
            expect(text, ":::inkflit code json\n\n:::end", "native paired backspace")
            key(48, "\t")
            later { [self] in content { [self] text in
                expect(text, ":::inkflit code json\n\(unit)\n:::end", "native Tab indentation")
                key(48, "\u{19}", "\t", .shift)
                later { [self] in content { [self] text in
                    expect(text, ":::inkflit code json\n\n:::end", "native Shift-Tab outdent")
                    sequence([{ self.key(25, "(", "9", .shift) }, { self.key(29, ")", "0", .shift) }]) { [self] in content { [self] text in
                        expect(text, ":::inkflit code json\n()\n:::end", "native bracket closer skips existing character")
                        sequence([{ self.key(53, "\u{1b}") }, { self.key(30, "]", "]", .command) }, { self.key(34, "i") }, { self.key(33, "{", "[", .shift) }]) { [self] in content { [self] text in
                            expect(text, "{", "ordinary text does not auto-pair")
                            sequence([{ self.key(53, "\u{1b}") }, { self.key(33, "[", "[", .command) }, { self.key(33, "[", "[", .command) }]) { [self] in
                                app.showSettings(); testCodeThemes(0)
                            }
                        } }
                    } }
                } }
            } }
        } }
    }
    private func testCodeThemes(_ index: Int) {
        if index == CodeThemes.all.count {
            testAppearance(0)
            return
        }
        let theme = CodeThemes.all[index]
        let dark = app.window.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        guard let expected = (dark ? theme.darkColors : theme.colors)["property"], let settings = app.settingsController,
              let preview = settings.testSelectCodeTheme(theme.id) else { fail("could not select theme or render preview") }
        expect(preview.lowercased(), expected.lowercased(), "native theme preview \(theme.id)")
        guard app.codeTheme() == theme.id else { fail("native theme preference was not saved") }
        later { [self] in
            let script = """
            (() => {
              const p=document.querySelector('.cm-content .tok-propertyName');
              const v=getComputedStyle(document.documentElement).getPropertyValue('--syntax-property').trim();
              const probe=document.createElement('span'); probe.style.color=v; document.body.append(probe);
              const expected=getComputedStyle(probe).color; probe.remove();
              return {id:document.documentElement.dataset.codeTheme, value:v, actual:p ? getComputedStyle(p).color : null, expected};
            })()
            """
            app.web.evaluateJavaScript(script) { [self] result, error in
                guard error == nil, let values = result as? [String: Any],
                      let id = values["id"] as? String, let value = values["value"] as? String,
                      let actual = values["actual"] as? String, let rgb = values["expected"] as? String else { fail("code theme or JSON property was not rendered") }
                expect(id, theme.id, "native applied theme")
                expect(value.lowercased(), expected.lowercased(), "native theme palette")
                expect(actual, rgb, "native JSON property color")
                testCodeThemes(index + 1)
            }
        }
    }
    private func testAppearance(_ index: Int) {
        let variants = [WindowAppearance(theme: "blue", opacity: 70, blur: 65), WindowAppearance(theme: "green", opacity: 85, blur: 0), WindowAppearance(theme: "orange", opacity: 100, blur: 0)]
        if index == variants.count {
            testLanguages(0); return
        }
        let expected = variants[index]
        guard let settings = app.settingsController, settings.testSetAppearance(expected) else { fail("could not set appearance") }
        settings.testSelectSettingsTab(1)
        let saved = app.windowAppearance()
        guard saved.theme == expected.theme && saved.opacity == expected.opacity && saved.blur == expected.blur else { fail("appearance preference mismatch") }
        // The window server blurs by radius; the effect view is only a fallback.
        if WindowBlur.isAvailable { guard app.backdrop.isHidden else { fail("effect view should be hidden when the window is blurred by radius") } }
        else { guard app.backdrop.isHidden == (expected.blur == 0), abs(app.backdrop.alphaValue - CGFloat(expected.blur) / 100) < 0.001 else { fail("backdrop state mismatch") } }
        later { [self] in
            app.web.evaluateJavaScript("[document.documentElement.dataset.uiTheme, document.documentElement.style.getPropertyValue('--ui-opacity'), getComputedStyle(document.querySelector('.app')).backgroundColor, getComputedStyle(document.querySelector('header')).height, getComputedStyle(document.querySelector('.drag-bar')).height]") { [self] value, error in
                guard error == nil, let values = value as? [String], values.count == 5 else { fail("could not read applied appearance") }
                expect(values[0], expected.theme, "native UI color")
                guard let opacity = Double(values[1]), abs(opacity - Double(expected.opacity) / 100) < 0.001 else { fail("web opacity mismatch") }
                guard values[2].contains(expected.opacity == 100 ? "rgb(" : "rgba(") else { fail("window background opacity missing") }
                expect(values[3], "36px", "native compact toolbar")
                expect(values[4], "10px", "native drag strip")
                print("PASS native opacity and blur \(expected.opacity)/\(expected.blur)")
                testCursorAppearance(index)
            }
        }
    }
    private func testCursorAppearance(_ index: Int) {
        app.showWindow()
        later { [self] in
            let script = """
            (() => {
              const root = getComputedStyle(document.documentElement), probe = document.createElement('span');
              probe.style.color = root.getPropertyValue('--ui-cursor'); document.body.append(probe);
              const expected = getComputedStyle(probe).color;
              probe.style.color = root.getPropertyValue('--ui-paper'); const text = getComputedStyle(probe).color; probe.remove();
              const cursor = document.querySelector('.cm-fat-cursor');
              return cursor ? [expected,text,getComputedStyle(cursor).backgroundColor,getComputedStyle(cursor).color] : null;
            })()
            """
            app.web.evaluateJavaScript(script) { [self] value, error in
                guard error == nil, let colors = value as? [String], colors.count == 4 else { fail("Vim block cursor was not rendered") }
                expect(colors[2], colors[0], "Vim block cursor theme color")
                expect(colors[3], colors[1], "Vim block cursor text contrast")
                key(34, "i")
                later { [self] in
                    app.web.evaluateJavaScript("(() => { const cursor=document.querySelector('.cm-cursorLayer:not(.cm-vimCursorLayer) .cm-cursor-primary'); return cursor ? getComputedStyle(cursor).borderLeftColor : null; })()") { [self] value, error in
                        guard error == nil, let color = value as? String else { fail("insert cursor was not rendered") }
                        expect(color, colors[0], "insert cursor theme color")
                        key(53, "\u{1b}")
                        testSearchAppearance(index)
                    }
                }
            }
        }
    }
    private func testSearchAppearance(_ index: Int) {
        sequence([{ self.key(44, "/") }, { self.key(40, "k") }]) { [self] in
            let script = """
            (() => {
              const root=getComputedStyle(document.documentElement), panel=document.querySelector('.cm-panels-bottom'), input=document.querySelector('.cm-vim-panel input'), hint=document.querySelector('.cm-vim-panel span[style*="color"]'), match=document.querySelector('.cm-searchMatch');
              if(!panel || !input || !hint || !match)return null;
              const probe=document.createElement('span'); document.body.append(probe);
              const color = value => { probe.style.color=value; return getComputedStyle(probe).color; };
              const expected=[color(root.getPropertyValue('--ui-ink')), color(root.getPropertyValue('--ui-cursor')), color(root.getPropertyValue('--ui-muted')), color(root.getPropertyValue('--ui-selection'))];
              probe.style.backgroundColor=`rgba(${root.getPropertyValue('--ui-bar-rgb')}, ${root.getPropertyValue('--ui-opacity')})`; const expectedBg=getComputedStyle(probe).backgroundColor;
              probe.remove();
              const bg=getComputedStyle(panel).backgroundColor;
              return [getComputedStyle(input).color,getComputedStyle(input).caretColor,getComputedStyle(hint).color,getComputedStyle(match).backgroundColor,...expected,bg,input.value,expectedBg];
            })()
            """
            app.web.evaluateJavaScript(script) { [self] value, error in
                guard error == nil, let colors = value as? [String], colors.count == 11 else { fail("Vim search panel or match was not rendered") }
                expect(colors[0], colors[4], "search input text color")
                expect(colors[1], colors[5], "search input caret color")
                expect(colors[2], colors[6], "search hint color")
                expect(colors[3], colors[7], "search match color")
                expect(colors[8], colors[10], "search panel background color")
                expect(colors[9], "k", "search input remains editable")
                key(53, "\u{1b}"); later { [self] in testAppearance(index + 1) }
            }
        }
    }
    private func testLanguages(_ index: Int) {
        let cases = [("en", "New note"), ("zh-Hans", "新建笔记"), ("zh-Hant", "新增筆記"), ("ja", "新規ノート")]
        if index == cases.count {
            content { [self] text in
                expect(text, completedText, "language changes preserve note content")
                testDeleteBeforeBlock()
            }
            return
        }
        let (language, label) = cases[index]
        guard let settings = app.settingsController, settings.testSelectLanguage(language) else { fail("could not select language \(language)") }
        later { [self] in
            app.web.evaluateJavaScript("[document.documentElement.lang, document.getElementById('new').getAttribute('aria-label')]") { [self] value, error in
                guard error == nil, let values = value as? [String], values.count == 2 else { fail("could not read language") }
                expect(values[0], language, "native language preference")
                expect(values[1], label, "native translated editor")
                guard Localization.preference == language, self.app.settingsController != nil else { fail("language did not persist or settings did not reopen") }
                testLanguages(index + 1)
            }
        }
    }
    private func testDeleteBeforeBlock() {
        app.showWindow()
        sequence([{ self.key(30, "]", "]", .command) }, { self.key(30, "]", "]", .command) }, { self.key(30, "]", "]", .command) }]) { [self] in
            content { [self] text in
                let original = "// comment\n\n:::inkflit code json\n{}\n:::end"
                expect(text, original, "native block spacing fixture")
                sequence([{ self.key(5, "g") }, { self.key(5, "g") }, { self.key(2, "d") }, { self.key(2, "d") }]) { [self] in content { [self] text in
                    expect(text, "\n:::inkflit code json\n{}\n:::end", "Vim delete preceding text line")
                    sequence([{ self.key(2, "d") }, { self.key(2, "d") }]) { [self] in content { [self] text in
                        expect(text, ":::inkflit code json\n{}\n:::end", "Vim delete blank line before block")
                        sequence([{ self.key(32, "u") }, { self.key(32, "u") }]) { [self] in content { [self] text in
                            expect(text, original, "Vim undo deleted lines before block")
                            testOpenAroundBlock()
                        } }
                    } }
                } }
            }
        }
    }
    private func testOpenAroundBlock() {
        let original = ":::inkflit code json\n{}\n:::end"
        sequence([{ self.key(30, "]", "]", .command) }, { self.key(31, "O", "o", [.command,.shift]) }, { self.key(0, "a") }]) { [self] in content { [self] text in
            expect(text, "a\n" + original, "Cmd Shift O opens editable text above first block")
            sequence([{ self.key(53, "\u{1b}") }, { self.key(32, "u") }]) { [self] in content { [self] text in
                expect(text, original, "undo opened line above block")
                key(15, "\u{12}", "r", .control)
                later { [self] in content { [self] text in
                expect(text, "a\n" + original, "redo opened line above block")
                sequence([{ self.key(32, "u") }, { self.key(5, "g") }, { self.key(5, "g") }, { self.key(31, "o", "o", .command) }, { self.key(11, "b") }]) { [self] in content { [self] text in
                    expect(text, original + "\nb", "Cmd O opens editable text below last block")
                    sequence([{ self.key(53, "\u{1b}") }, { self.key(32, "u") }]) { [self] in content { [self] text in
                        expect(text, original, "undo opened line below block")
                        key(15, "\u{12}", "r", .control)
                        later { [self] in content { [self] text in
                        expect(text, original + "\nb", "redo opened line below block")
                        sequence([{ self.key(32, "u") }, { self.key(5, "g") }, { self.key(5, "g") }, { self.key(34, "i") }, { self.key(31, "O", "o", [.command,.shift]) }, { self.key(8, "c") }]) { [self] in content { [self] text in
                            expect(text, "c\n" + original, "Cmd Shift O works from insert mode")
                            sequence([{ self.key(53, "\u{1b}") }, { self.key(32, "u") }, { self.key(5, "g") }, { self.key(5, "g") }, { self.key(34, "i") }, { self.key(31, "o", "o", .command) }, { self.key(2, "d") }]) { [self] in content { [self] text in
                                expect(text, original + "\nd", "Cmd O works from insert mode")
                                testListIndentation()
                            } }
                        } }
                        } }
                    } }
                } }
                } }
            } }
        } }
    }
    private func testListIndentation(alreadySelected: Bool = false) {
        let original = ":::inkflit list\nroot\n  parent\napple\n[x] done\n- [ ] task\n:::end"
        let indented = ":::inkflit list\nroot\n  parent\n  apple\n[x] done\n- [ ] task\n:::end"
        let start: [() -> Void] = alreadySelected ? [{ self.key(48, "\t") }] : [{ self.key(53, "\u{1b}") }, { self.key(30, "]", "]", .command) }, { self.key(48, "\t") }]
        sequence(start) { [self] in content { [self] text in
            expect(text, original, "root item cannot indent")
            sequence([{ self.key(38, "j") }, { self.key(38, "j") }, { self.key(48, "\t") }]) { [self] in content { [self] text in
                expect(text, indented, "normal mode Tab indents checklist item")
                sequence([{ self.key(32, "u") }]) { [self] in content { [self] text in
                    expect(text, original, "undo checklist indentation")
                    sequence([{ self.key(15, "\u{12}", "r", .control) }]) { [self] in content { [self] text in
                        expect(text, indented, "redo checklist indentation")
                        sequence([{ self.key(48, "\u{19}", "\t", .shift) }]) { [self] in content { [self] text in
                            expect(text, original, "normal mode Shift Tab outdents checklist item")
                            sequence([{ self.key(34, "i") }, { self.key(48, "\t") }, { self.key(48, "\t") }, { self.key(48, "\t") }]) { [self] in content { [self] text in
                                expect(text, ":::inkflit list\nroot\n  parent\n    apple\n[x] done\n- [ ] task\n:::end", "nested indentation stops one level below previous item")
                                app.web.evaluateJavaScript("[...document.querySelectorAll('.task-checkbox')].map(item => item.getBoundingClientRect().left)") { [self] value, error in
                                    guard error == nil, let positions = value as? [Double], positions.count == 5, positions[2] > positions[1] + 5 else { fail("nested checklist checkbox was not rendered at its indentation") }
                                    print("PASS nested checklist checkbox indentation")
                                    sequence([{ self.key(48, "\u{19}", "\t", .shift) }]) { [self] in content { [self] text in
                                        expect(text, indented, "insert mode Shift Tab outdents checklist item")
                                        print("PASS native configuration \(app.codeIndentation())")
                                        app.restoreInputSource(); exit(0)
                                    } }
                                }
                            } }
                        } }
                    } }
                } }
            } }
        } }
    }
}
