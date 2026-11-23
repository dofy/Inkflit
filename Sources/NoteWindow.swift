import Cocoa
import WebKit

final class NotePanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}
final class DragWebView: WKWebView {
    override var isOpaque: Bool { false }
}
class WindowDragView: NSView {
    private var dragStart: NSPoint?
    private var windowStart: NSPoint?
    override func mouseDown(with event: NSEvent) {
        guard let window else { return }
        dragStart = window.convertPoint(toScreen: event.locationInWindow)
        windowStart = window.frame.origin
    }
    override func mouseDragged(with event: NSEvent) {
        guard let window, let dragStart, let windowStart else { return }
        let point = window.convertPoint(toScreen: event.locationInWindow)
        window.setFrameOrigin(NSPoint(x: windowStart.x + point.x - dragStart.x,
                                      y: windowStart.y + point.y - dragStart.y))
    }
    override func mouseUp(with event: NSEvent) { dragStart = nil; windowStart = nil }
}
final class ToolbarDragView: WindowDragView {
    var buttonRects: [NSRect] = [] { didSet { window?.invalidateCursorRects(for: self) } }
    var measuredWidth: CGFloat = 0 { didSet { window?.invalidateCursorRects(for: self) } }
    override var isFlipped: Bool { true }
    private var buttonExclusions: [NSRect] {
        if !buttonRects.isEmpty && abs(measuredWidth - bounds.width) <= 1 { return buttonRects }
        return [NSRect(x: 0, y: 10, width: 130, height: max(0, bounds.height - 10)),
                NSRect(x: max(0, bounds.width - 180), y: 10, width: 180, height: max(0, bounds.height - 10))]
    }
    override func hitTest(_ point: NSPoint) -> NSView? {
        let local = convert(point, from: superview)
        guard bounds.contains(local) else { return nil }
        // Until WebKit reports its current layout, leave both button groups alone.
        if buttonExclusions.contains(where: { $0.contains(local) }) { return nil }
        return self
    }
    override func resetCursorRects() {
        var areas = [bounds]
        for button in buttonExclusions {
            areas = areas.flatMap { area -> [NSRect] in
                let overlap = area.intersection(button)
                guard !overlap.isNull, !overlap.isEmpty else { return [area] }
                return [NSRect(x:area.minX, y:area.minY, width:overlap.minX-area.minX, height:area.height),
                        NSRect(x:overlap.maxX, y:area.minY, width:area.maxX-overlap.maxX, height:area.height),
                        NSRect(x:overlap.minX, y:area.minY, width:overlap.width, height:overlap.minY-area.minY),
                        NSRect(x:overlap.minX, y:overlap.maxY, width:overlap.width, height:area.maxY-overlap.maxY)].filter { $0.width > 0 && $0.height > 0 }
            }
        }
        for area in areas { addCursorRect(area, cursor: .arrow) }
    }
}
enum WindowPlacement {
    static func defaultSize(in visible: NSSize) -> NSSize {
        let width = max(1, min(480, (visible.height - 32) * 2 / 3, visible.width - 32))
        return NSSize(width: width, height: width * 3 / 2)
    }

    struct Anchor {
        let left: CGFloat, right: CGFloat, bottom: CGFloat, top: CGFloat
    }
    static func anchor(_ frame: NSRect, in source: NSRect) -> Anchor {
        let horizontalSpace = max(0, source.width - frame.width), verticalSpace = max(0, source.height - frame.height)
        let left = max(0, min(horizontalSpace, frame.minX-source.minX)), right = horizontalSpace-left
        let bottom = max(0, min(verticalSpace, frame.minY-source.minY)), top = verticalSpace-bottom
        return Anchor(left: horizontalSpace > 0 ? left / horizontalSpace : 0.5,
                      right: horizontalSpace > 0 ? right / horizontalSpace : 0.5,
                      bottom: verticalSpace > 0 ? bottom / verticalSpace : 0.5,
                      top: verticalSpace > 0 ? top / verticalSpace : 0.5)
    }
    static func frame(size: NSSize, anchor: Anchor, in destination: NSRect) -> NSRect {
        guard destination.width > 0, destination.height > 0 else { return NSRect(origin: destination.origin, size: size) }
        let width = min(size.width, destination.width), height = min(size.height, destination.height)
        let xSpace = max(0, destination.width-width), ySpace = max(0, destination.height-height)
        let xOffset = anchor.right < anchor.left ? 1-anchor.right : anchor.left
        let yOffset = anchor.top < anchor.bottom ? 1-anchor.top : anchor.bottom
        return NSRect(x: destination.minX + xSpace * max(0,min(1,xOffset)),
                      y: destination.minY + ySpace * max(0,min(1,yOffset)), width: width, height: height)
    }
    static func onScreen(_ frame: NSRect, from source: NSRect, to destination: NSRect) -> NSRect {
        guard source.width > 0, source.height > 0, destination.width > 0, destination.height > 0 else { return frame }
        return self.frame(size: frame.size, anchor: anchor(frame, in: source), in: destination)
    }
}

/// Background blur by radius, from the window server: it blurs whatever is
/// behind the window, the way Terminal and iTerm2 do. NSVisualEffectView has
/// no radius, and fading it only mixes blurred and sharp content, so text
/// behind the note stayed readable. The SPI is looked up at run time; when it
/// is missing the effect view is used instead.
enum WindowBlur {
    private typealias MainConnection = @convention(c) () -> Int32
    private typealias SetRadius = @convention(c) (Int32, UInt32, UInt32) -> Int32
    private static let functions: (MainConnection, SetRadius)? = {
        guard let handle = dlopen(nil, RTLD_NOW),
              let main = dlsym(handle, "CGSMainConnectionID"), let set = dlsym(handle, "CGSSetWindowBackgroundBlurRadius") else { return nil }
        return (unsafeBitCast(main, to: MainConnection.self), unsafeBitCast(set, to: SetRadius.self))
    }()
    static var isAvailable: Bool { functions != nil }
    /// 0–100 % in Settings maps to a 0–40 point radius.
    static func radius(forPercent percent: Int) -> Int { Int((Double(max(0, min(100, percent))) * 0.4).rounded()) }
    static func set(_ window: NSWindow, radius: Int) {
        guard let (main, set) = functions, window.windowNumber > 0 else { return }
        _ = set(main(), UInt32(window.windowNumber), UInt32(radius))
    }
}
