import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

let hostName = "com.meowtantra.keyboard"
let browserIDs: Set<String> = ["com.google.Chrome", "com.google.Chrome.beta", "com.google.Chrome.dev", "com.google.Chrome.canary", "com.google.Chrome.forTesting", "com.google.chrome.for.testing", "org.chromium.Chromium", "com.microsoft.edgemac", "com.microsoft.edgemac.Beta", "com.microsoft.edgemac.Dev"]
struct HostError: Error, CustomStringConvertible {
    let description: String
    init(_ message: String) { description = message }
}
func validID(_ id: String) -> Bool { id.range(of: "^[a-p]{32}$", options: .regularExpression) != nil }
func install(_ id: String, browser: String) throws {
    guard validID(id) else { throw HostError("Enter the 32-letter extension ID shown by MeowCheats or chrome://extensions.") }
    let directories = ["chrome": "Google/Chrome", "edge": "Microsoft Edge", "chromium": "Chromium", "testing": "Google/ChromeForTesting"]
    guard let directory = directories[browser] else { throw HostError("Choose chrome, edge, chromium, or testing.") }
    let base = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/\(directory)/NativeMessagingHosts")
    try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
    let executable = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL.path
    let manifest: [String: Any] = ["name": hostName, "description": "MeowCheats macOS simulated keyboard", "path": executable, "type": "stdio", "allowed_origins": ["chrome-extension://\(id)/"]]
    let data = try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys])
    let destination = base.appendingPathComponent("\(hostName).json")
    try data.write(to: destination, options: .atomic)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: destination.path)
    print("Installed keyboard helper for extension \(id) in \(browser).")
    print("Manifest: \(destination.path)")
    print("In the extension, click Request macOS keyboard permission. Enable the app macOS identifies in System Settings → Privacy & Security → Accessibility.")
}
func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
    return value
}
func axElement(_ element: AXUIElement, _ name: String) -> AXUIElement? {
    guard let value = attribute(element, name), CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return (value as! AXUIElement)
}
struct FocusSnapshot {
    let window: AXUIElement?
    let windowNumber: CGWindowID?
    let field: AXUIElement?

    func matches(_ current: FocusSnapshot) -> Bool {
        // Prefer window-server IDs: Chrome may expose AX objects lazily or rebuild them.
        if let number = windowNumber {
            guard current.windowNumber == number else { return false }
        } else if let oldWindow = window, let newWindow = current.window {
            guard CFEqual(oldWindow, newWindow) else { return false }
        } else { return false }
        if let oldField = field {
            guard let newField = current.field, CFEqual(oldField, newField) else { return false }
        }
        // If no native field was exposed initially, the extension's isolated-world
        // guard still checks the exact original DOM element before every key.
        return true
    }
}
func frontWindowNumber(_ processID: pid_t) -> CGWindowID? {
    guard let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return nil }
    for item in windows {
        if item[kCGWindowOwnerPID as String] as? Int == Int(processID),
           item[kCGWindowLayer as String] as? Int == 0,
           let number = item[kCGWindowNumber as String] as? UInt32 {
            return number
        }
    }
    return nil
}
// US virtual key identities plus Unicode payloads. Enter and Tab retain editor behavior.
func keyInfo(_ character: String) -> (CGKeyCode, Bool) {
    if character == "\n" { return (36, false) }
    if character == "\t" { return (48, false) }
    let letters: [Character: CGKeyCode] = ["a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17, "o": 31, "u": 32, "i": 34, "p": 35, "l": 37, "j": 38, "k": 40, "n": 45, "m": 46]
    if let first = character.lowercased().first, let key = letters[first], character.unicodeScalars.count == 1, character.unicodeScalars.first!.value < 128 { return (key, character != character.lowercased()) }
    let pairs: [(String, String, CGKeyCode)] = [("1", "!", 18), ("2", "@", 19), ("3", "#", 20), ("4", "$", 21), ("6", "^", 22), ("5", "%", 23), ("=", "+", 24), ("9", "(", 25), ("7", "&", 26), ("-", "_", 27), ("8", "*", 28), ("0", ")", 29), ("]", "}", 30), ("[", "{", 33), ("'", "\"", 39), (";", ":", 41), ("\\", "|", 42), (",", "<", 43), ("/", "?", 44), (".", ">", 47), ("`", "~", 50), (" ", " ", 49)]
    for (plain, shifted, key) in pairs { if character == plain { return (key, false) }; if character == shifted { return (key, true) } }
    return (0, false)
}
func validateCharacter(_ value: Any?) throws -> String {
    guard let text = value as? String, text.unicodeScalars.count == 1, let scalar = text.unicodeScalars.first else { throw HostError("Send exactly one Unicode scalar per key request.") }
    guard scalar.value >= 32 || text == "\n" || text == "\t", scalar.value != 127 else { throw HostError("Control characters other than Enter and Tab are not supported.") }
    return text
}
// Backspace is an explicit, session-guarded action, never a control character
// hidden in a pasted draft. No other navigation or shortcut keys are accepted.
func validateKey(_ message: [String: Any]) throws -> String? {
    if let action = message["action"] {
        guard action as? String == "backspace", message["character"] == nil else { throw HostError("Unsupported or ambiguous keyboard action.") }
        return nil
    }
    return try validateCharacter(message["character"])
}
final class KeyboardHost {
    var token: String?
    var sequence = 0
    var processID: pid_t = 0
    var application: AXUIElement?
    var focus: FocusSnapshot?
    func clear() { token = nil; application = nil; focus = nil; sequence = 0 }
    func permissionStatus(prompt: Bool = false) -> (accessibility: Bool, axTrusted: Bool, postEventAccess: Bool) {
        if prompt {
            _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
            if !CGPreflightPostEventAccess() { _ = CGRequestPostEventAccess() }
        }
        let axTrusted = AXIsProcessTrusted()
        let postEventAccess = CGPreflightPostEventAccess()
        return (axTrusted && postEventAccess, axTrusted, postEventAccess)
    }
    func permission() -> Bool { permissionStatus().accessibility }
    func browser() throws -> NSRunningApplication {
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.001))
        guard let front = NSWorkspace.shared.frontmostApplication, let id = front.bundleIdentifier, browserIDs.contains(id) else { throw HostError("Bring Chrome or Edge to the front and click the destination field.") }
        return front
    }
    func focused(_ app: AXUIElement, processID: pid_t, readNativeWindow: Bool = true, readNativeField: Bool = true) throws -> FocusSnapshot {
        let win = readNativeWindow ? axElement(app, kAXFocusedWindowAttribute) : nil
        let number = frontWindowNumber(processID)
        guard win != nil || number != nil else { throw HostError("The browser has no identifiable visible window. Bring the website window to the front and retry.") }
        let input = readNativeField ? axElement(app, kAXFocusedUIElementAttribute) : nil
        var editableInput: AXUIElement?
        if let input = input {
            let role = attribute(input, kAXRoleAttribute) as? String
            let subrole = attribute(input, kAXSubroleAttribute) as? String
            if role == "AXSecureTextField" || subrole == "AXSecureTextField" { throw HostError("Password fields are not supported.") }
            // Generic web-area/group objects can be replaced when Chrome enables
            // its accessibility tree; they are not a reliable field identity.
            if ["AXTextField", "AXTextArea", "AXComboBox"].contains(role ?? "") { editableInput = input }
        }
        return FocusSnapshot(window: win, windowNumber: number, field: editableInput)
    }
    func handle(_ message: [String: Any]) throws -> [String: Any] {
        switch message["command"] as? String {
        case "check":
            let status = permissionStatus(prompt: message["prompt"] as? Bool == true)
            let result: [String: Any] = ["accessibility": status.accessibility, "axTrusted": status.axTrusted,
                                         "postEventAccess": status.postEventAccess, "platform": "mac", "protocol": 3,
                                         "capabilities": ["backspace": true]]
            return result
        case "begin":
            clear()
            guard message["focusGuard"] as? String == "isolated-field-v2" else { throw HostError("Reload MeowCheats in chrome://extensions to enable the updated field guard.") }
            guard permission() else { throw HostError("Accessibility permission is required for MeowCheats Keyboard.") }
            guard let newToken = message["token"] as? String, newToken.range(of: "^[A-Za-z0-9-]{16,128}$", options: .regularExpression) != nil else { throw HostError("Invalid keyboard session token.") }
            let front = try browser()
            let app = AXUIElementCreateApplication(front.processIdentifier)
            AXUIElementSetMessagingTimeout(app, 0.3)
            // Asking for the role activates Chrome's native accessibility support.
            // A web editor still need not expose AXFocusedUIElement; the extension
            // is the authoritative source for its exact DOM focus.
            _ = attribute(app, kAXRoleAttribute)
            let snapshot = try focused(app, processID: front.processIdentifier)
            processID = front.processIdentifier
            // Chrome can replace its AX text-field proxy on every Ace input.
            // The extension checks the exact DOM element before EACH key. Lock
            // native process/window identity here, not that transient AX proxy.
            application = app
            focus = FocusSnapshot(window: snapshot.window, windowNumber: snapshot.windowNumber, field: nil)
            token = newToken
            return ["ready": true, "nativeField": false, "focusGuard": "isolated-field-v2"]
        case "key":
            guard let expected = token, message["token"] as? String == expected, message["sequence"] as? Int == sequence else { throw HostError("Keyboard session or key sequence is invalid.") }
            guard message["focusGuard"] as? String == "isolated-field-v2" else { throw HostError("The extension must confirm the original DOM field before each key.") }
            let character = try validateKey(message)
            guard permission() else { clear(); throw HostError("Accessibility permission was revoked.") }
            let front = try browser()
            guard front.processIdentifier == processID, let app = application, let oldFocus = focus else { clear(); throw HostError("Browser focus changed. Typing stopped.") }
            let current = try focused(app, processID: processID,
                readNativeWindow: oldFocus.windowNumber == nil, readNativeField: oldFocus.field != nil)
            guard oldFocus.matches(current) else { clear(); throw HostError("The focused window or field changed. Typing stopped.") }
            if CGEventSource.keyState(.combinedSessionState, key: 53) { clear(); throw HostError("Escape pressed. Typing stopped.") }
            let flags = CGEventSource.flagsState(.combinedSessionState)
            if !flags.intersection([.maskCommand, .maskControl, .maskAlternate, .maskShift]).isEmpty { clear(); throw HostError("A modifier key is held. Typing stopped to avoid triggering shortcuts.") }
            let (key, shifted): (CGKeyCode, Bool) = character.map(keyInfo) ?? (51, false)
            guard let source = CGEventSource(stateID: .privateState), let down = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: true), let up = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: false) else { throw HostError("macOS could not create a keyboard event.") }
            down.flags = shifted ? .maskShift : []; up.flags = shifted ? .maskShift : []
            if let character = character, character != "\n" && character != "\t" {
                let units = Array(character.utf16)
                units.withUnsafeBufferPointer { buffer in
                    down.keyboardSetUnicodeString(stringLength: units.count, unicodeString: buffer.baseAddress)
                    up.keyboardSetUnicodeString(stringLength: units.count, unicodeString: buffer.baseAddress)
                }
            }
            down.postToPid(processID)
            Thread.sleep(forTimeInterval: 0.008)
            up.postToPid(processID)
            sequence += 1
            return ["sent": sequence]
        case "stop": clear(); return ["stopped": true]
        default: throw HostError("Unknown keyboard helper command.")
        }
    }
}
func readExactly(_ length: Int) -> Data? {
    var data = Data()
    while data.count < length {
        let chunk = FileHandle.standardInput.readData(ofLength: length - data.count)
        if chunk.isEmpty { return nil }
        data.append(chunk)
    }
    return data
}
func respond(_ reply: [String: Any]) throws {
    let data = try JSONSerialization.data(withJSONObject: reply, options: [.sortedKeys])
    var size = UInt32(data.count).littleEndian
    let header = withUnsafeBytes(of: &size) { Data($0) }
    try FileHandle.standardOutput.write(contentsOf: header + data)
}
do {
    if CommandLine.arguments.dropFirst().first == "--install" {
        guard CommandLine.arguments.count >= 3 else { throw HostError("Usage: --install EXTENSION_ID [chrome|edge|chromium|testing]") }
        try install(CommandLine.arguments[2], browser: CommandLine.arguments.count > 3 ? CommandLine.arguments[3] : "chrome")
    } else if CommandLine.arguments.dropFirst().first == "--self-test" {
        guard validID(String(repeating: "a", count: 32)), !validID("bad"), keyInfo("A").0 == 0, keyInfo("A").1, keyInfo("\n").0 == 36, keyInfo("\t").0 == 48, try validateCharacter("😀") == "😀" else { throw HostError("Keyboard validation failed.") }
        var rejected = false
        do { _ = try validateCharacter("ab") } catch { rejected = true }
        guard rejected else { throw HostError("Multiple characters were accepted.") }
        guard try validateKey(["action": "backspace"]) == nil,
              try validateKey(["character": "x"]) == "x" else { throw HostError("Indentation key validation failed.") }
        for invalid in [["action": "delete"], ["action": "backspace", "character": "x"], ["character": "\u{08}"]] {
            var invalidRejected = false
            do { _ = try validateKey(invalid) } catch { invalidRejected = true }
            guard invalidRejected else { throw HostError("An unsupported keyboard action was accepted.") }
        }
        let locked = FocusSnapshot(window: nil, windowNumber: 101, field: nil)
        guard locked.matches(FocusSnapshot(window: nil, windowNumber: 101, field: nil)),
              !locked.matches(FocusSnapshot(window: nil, windowNumber: 102, field: nil)),
              !locked.matches(FocusSnapshot(window: nil, windowNumber: nil, field: nil)),
              !FocusSnapshot(window: nil, windowNumber: nil, field: nil).matches(locked) else { throw HostError("Window identity checks failed.") }
        let fakeField = AXUIElementCreateApplication(12345)
        let fieldLock = FocusSnapshot(window: nil, windowNumber: 101, field: fakeField)
        guard fieldLock.matches(FocusSnapshot(window: nil, windowNumber: 101, field: fakeField)),
              !fieldLock.matches(locked),
              !fieldLock.matches(FocusSnapshot(window: nil, windowNumber: 101, field: AXUIElementCreateApplication(12346))) else { throw HostError("Native field identity checks failed.") }
        print("PASS extension ID, Unicode scalar and virtual key validation; Accessibility currently \(KeyboardHost().permission()). No keys sent.")
    } else {
        guard let origin = CommandLine.arguments.dropFirst().first, origin.hasPrefix("chrome-extension://"), origin.hasSuffix("/"), validID(String(origin.dropFirst(19).dropLast())) else { throw HostError("Launch this helper through Chrome native messaging.") }
        let host = KeyboardHost()
        while let header = readExactly(4) {
            let size = header.enumerated().reduce(UInt32(0)) { $0 | UInt32($1.element) << ($1.offset * 8) }
            guard size > 0, size <= 65536, let payload = readExactly(Int(size)) else { break }
            var id: Any = NSNull()
            do {
                guard let message = try JSONSerialization.jsonObject(with: payload) as? [String: Any] else { throw HostError("Expected a JSON object.") }
                id = message["id"] as? Int ?? NSNull()
                try respond(["id": id, "ok": true, "result": try host.handle(message)])
            } catch {
                host.clear()
                try respond(["id": id, "ok": false, "error": String(describing: error)])
            }
        }
        host.clear()
    }
} catch {
    FileHandle.standardError.write(Data("\(error)\n".utf8))
    exit(1)
}
