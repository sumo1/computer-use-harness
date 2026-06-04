import AppKit
import ApplicationServices
import Foundation

private let maxAXDepth = 8
private let maxAXElements = 350

private final class OpenErrorBox: @unchecked Sendable {
    var error: Error?
}

runStdioLoop()

private func runStdioLoop() {
    var buffer = Data()
    let newline = Data([0x0A])

    while true {
        let chunk = FileHandle.standardInput.availableData
        if chunk.isEmpty {
            break
        }

        buffer.append(chunk)

        while let range = buffer.range(of: newline) {
            let lineData = buffer.subdata(in: buffer.startIndex..<range.lowerBound)
            buffer.removeSubrange(buffer.startIndex..<range.upperBound)
            handleRequestDataLine(lineData)
        }
    }

    if !buffer.isEmpty {
        handleRequestDataLine(buffer)
    }
}

private func handleRequestDataLine(_ data: Data) {
    guard let line = String(data: data, encoding: .utf8) else {
        writeJsonLine(response(id: nil, error: rpcError(code: "INVALID_JSON", message: "Request must be UTF-8.")))
        return
    }

    let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty {
        return
    }

    let response = handleRequestLine(trimmed)
    writeJsonLine(response)
}

private func handleRequestLine(_ line: String) -> [String: Any] {
    do {
        guard
            let data = line.data(using: .utf8),
            let raw = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return response(id: nil, error: rpcError(code: "INVALID_JSON", message: "Request must be a JSON object."))
        }

        return handleRequest(raw)
    } catch {
        return response(id: nil, error: rpcError(code: "INVALID_JSON", message: error.localizedDescription))
    }
}

private func handleRequest(_ request: [String: Any]) -> [String: Any] {
    let id = request["id"]

    guard request["jsonrpc"] as? String == "2.0" else {
        return response(
            id: id,
            error: rpcError(code: "INVALID_REQUEST", message: "jsonrpc must be '2.0'.")
        )
    }

    guard let method = request["method"] as? String else {
        return response(
            id: id,
            error: rpcError(code: "INVALID_REQUEST", message: "method is required.")
        )
    }

    let params = request["params"] as? [String: Any] ?? [:]

    switch method {
    case "permissionStatus":
        return response(id: id, result: permissionStatus())
    case "listApps":
        return response(id: id, result: ["apps": listApps()])
    case "listWindows":
        return response(id: id, result: ["windows": listWindows(params: params)])
    case "getAppState":
        return response(id: id, result: appState(params: params))
    case "screenshot":
        return handleScreenshot(id: id, params: params)
    case "open", "click", "secondary-click", "hover", "drag", "type", "key", "scroll":
        return handleAction(id: id, method: method, paramsValue: request["params"])
    default:
        return response(
            id: id,
            error: rpcError(code: "UNKNOWN_METHOD", message: "Unknown method '\(method)'.")
        )
    }
}

private func permissionStatus() -> [String: Any] {
    return [
        "accessibility": AXIsProcessTrusted() ? "granted" : "missing",
        "screenRecording": CGPreflightScreenCaptureAccess() ? "granted" : "missing",
        "inputMonitoring": "unknown",
    ]
}

private func listApps() -> [[String: Any]] {
    return NSWorkspace.shared.runningApplications.compactMap { app in
        guard let name = app.localizedName, !name.isEmpty else {
            return nil
        }

        return [
            "appId": app.bundleIdentifier ?? "",
            "name": name,
            "pid": Int(app.processIdentifier),
        ]
    }
}

private func listWindows(params: [String: Any]) -> [[String: Any]] {
    let target = readTarget(params: params)
    let app = findRunningApp(target: target)
    let ownerName = (target["name"] as? String)?.lowercased()
    let ownerPid = app?.processIdentifier

    guard
        let rawWindows = CGWindowListCopyWindowInfo(
            [.optionOnScreenOnly, .excludeDesktopElements],
            kCGNullWindowID
        ) as? [[String: Any]]
    else {
        return []
    }

    return rawWindows.compactMap { window in
        let windowOwner = (window[kCGWindowOwnerName as String] as? String) ?? ""
        let windowPid = window[kCGWindowOwnerPID as String] as? pid_t

        if let ownerPid, windowPid != ownerPid {
            return nil
        }

        if ownerPid == nil, let ownerName, !windowOwner.lowercased().contains(ownerName) {
            return nil
        }

        let windowId = window[kCGWindowNumber as String] as? UInt32
        let title = (window[kCGWindowName as String] as? String) ?? windowOwner

        return [
            "id": String(windowId ?? 0),
            "appId": target["id"] as? String ?? "",
            "title": title,
            "focused": false,
        ]
    }
}

private func appState(params: [String: Any]) -> [String: Any] {
    let target = readTarget(params: params)
    let windows = listWindows(params: params)
    let elements = collectAXElements(target: target)

    let permissions: [String: String] = [
        "accessibility": AXIsProcessTrusted() ? "granted" : "missing",
        "screenRecording": CGPreflightScreenCaptureAccess() ? "granted" : "missing",
        "inputMonitoring": "unknown",
    ]

    var observation: [String: Any] = [
        "id": "\(target["id"] as? String ?? "target"):observation:mac-helper",
        "target": target,
        "source": "mac-helper",
        "timestamp": timestamp(),
        "elements": elements,
        "metadata": [
            "helperMethod": "getAppState",
            "windowCount": windows.count,
            "elementCount": elements.count,
            "accessibility": permissions["accessibility"] ?? "unknown",
        ],
    ]

    if permissions["screenRecording"] == "granted", let screenshot = captureAppScreenshot(target: target) {
        observation["screenshot"] = screenshot
    }

    if !elements.isEmpty {
        observation["accessibilityTree"] = buildAccessibilityTree(elements: elements)
    }

    if let focusedId = findFocusedElementId(elements: elements) {
        observation["focusedElementId"] = focusedId
    }

    if let focusedWin = findFocusedWindow(windows: windows, target: target) {
        observation["focusedWindow"] = focusedWin
    }

    observation["windows"] = windows

    if let mainScreen = NSScreen.main {
        observation["coordinateSpace"] = [
            "screenWidth": mainScreen.frame.width,
            "screenHeight": mainScreen.frame.height,
            "scale": mainScreen.backingScaleFactor,
        ]
    }

    observation["permissions"] = permissions

    return [
        "target": target,
        "windows": windows,
        "observation": observation,
    ]
}

private func handleAction(id: Any?, method: String, paramsValue: Any?) -> [String: Any] {
    guard let params = paramsValue as? [String: Any] else {
        return response(
            id: id,
            error: rpcError(code: "INVALID_REQUEST", message: "\(method) params must be an object.")
        )
    }

    guard let action = params["action"] as? [String: Any] else {
        return response(
            id: id,
            error: rpcError(code: "INVALID_REQUEST", message: "\(method) params.action is required.")
        )
    }

    guard let actionId = nonEmptyString(action["id"]) else {
        return response(
            id: id,
            error: rpcError(code: "INVALID_REQUEST", message: "\(method) action.id is required.")
        )
    }

    if let failure = validateActionRequest(action: action, params: params, method: method, actionId: actionId) {
        return response(id: id, result: failure)
    }

    if method == "open" {
        return response(id: id, result: performOpen(action: action, actionId: actionId, method: method))
    }

    if !AXIsProcessTrusted() {
        return response(
            id: id,
            result: failedActionResult(
                actionId: actionId,
                method: method,
                code: "PERMISSION_REQUIRED",
                message: "Accessibility permission is required before executing \(method).",
                details: ["permission": "accessibility"]
            )
        )
    }

    switch method {
    case "open":
        break
    case "click":
        return response(id: id, result: performClick(action: action, actionId: actionId, method: method))
    case "secondary-click":
        return response(id: id, result: performSecondaryClick(action: action, actionId: actionId, method: method))
    case "hover":
        return response(id: id, result: performHover(action: action, actionId: actionId, method: method))
    case "drag":
        return response(id: id, result: performDrag(action: action, actionId: actionId, method: method))
    case "type":
        return response(
            id: id,
            result: performType(
                action: action,
                actionId: actionId,
                method: method,
                text: nonEmptyString(params["text"]) ?? ""
            )
        )
    case "key":
        return response(
            id: id,
            result: performKey(
                action: action,
                actionId: actionId,
                method: method,
                key: nonEmptyString(params["key"]) ?? ""
            )
        )
    case "scroll":
        return response(
            id: id,
            result: performScroll(
                action: action,
                actionId: actionId,
                method: method,
                direction: nonEmptyString(params["direction"]) ?? "",
                amount: numberDouble(params["amount"]) ?? 1.0
            )
        )
    default:
        break
    }

    return response(
        id: id,
        result: failedActionResult(
            actionId: actionId,
            method: method,
            code: "UNIMPLEMENTED",
            message: "Action method '\(method)' is validated but not implemented yet."
        )
    )
}

private func collectAXElements(target: [String: Any]) -> [[String: Any]] {
    guard AXIsProcessTrusted() else {
        return []
    }

    guard let app = findRunningApp(target: target) else {
        return []
    }

    let root = AXUIElementCreateApplication(app.processIdentifier)
    var elements: [[String: Any]] = []
    collectAXElement(
        root,
        target: target,
        app: app,
        path: [],
        depth: 0,
        elements: &elements
    )

    return elements
}

private func captureAppScreenshot(target: [String: Any]) -> [String: Any]? {
    guard let app = findRunningApp(target: target) else {
        return nil
    }

    let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []

    let appWindows = windows.filter { window in
        if let owner = window[kCGWindowOwnerPID as String] as? Int32 {
            return owner == app.processIdentifier
        }
        return false
    }

    guard let mainWindow = appWindows.first,
          let windowNumber = mainWindow[kCGWindowNumber as String] as? CGWindowID else {
        return nil
    }

    guard let cgImage = CGWindowListCreateImage(
        .null,
        .optionIncludingWindow,
        windowNumber,
        [.boundsIgnoreFraming, .bestResolution]
    ) else {
        return nil
    }

    let bitmapRep = NSBitmapImageRep(cgImage: cgImage)
    guard let pngData = bitmapRep.representation(using: .png, properties: [:]) else {
        return nil
    }

    return [
        "format": "png",
        "data": pngData.base64EncodedString(),
        "width": cgImage.width,
        "height": cgImage.height,
        "timestamp": timestamp(),
    ]
}

private struct AccessibilityTreeEntry {
    let path: [Int]
    let node: [String: Any]
}

private func buildAccessibilityTree(elements: [[String: Any]]) -> [[String: Any]] {
    let entries = elements.compactMap { accessibilityTreeEntry(element: $0) }
    let roots = entries.filter { $0.path.isEmpty }

    if !roots.isEmpty {
        return roots.map { accessibilityTreeNode(entry: $0, entries: entries) }
    }

    let minimumDepth = entries.map { $0.path.count }.min()
    guard let minimumDepth else {
        return []
    }

    return entries
        .filter { $0.path.count == minimumDepth }
        .map { accessibilityTreeNode(entry: $0, entries: entries) }
}

private func accessibilityTreeEntry(element: [String: Any]) -> AccessibilityTreeEntry? {
    guard let id = element["id"] as? String,
          let role = element["role"] as? String,
          let metadata = element["metadata"] as? [String: Any],
          let pathString = metadata["path"] as? String,
          let path = decodeAXPath(pathString)
    else {
        return nil
    }

    var node: [String: Any] = [
        "id": id,
        "role": role,
        "metadata": metadata,
    ]

    if let name = element["name"] as? String {
        node["name"] = name
    }
    if let value = metadata["value"] as? String {
        node["value"] = value
    }
    if let frame = metadata["frame"] as? [String: Any] {
        node["bounds"] = frame
    }

    return AccessibilityTreeEntry(path: path, node: node)
}

private func accessibilityTreeNode(entry: AccessibilityTreeEntry, entries: [AccessibilityTreeEntry]) -> [String: Any] {
    var node = entry.node
    let children = entries
        .filter { isDirectChildPath($0.path, of: entry.path) }
        .sorted { encodeAXPath($0.path) < encodeAXPath($1.path) }
        .map { accessibilityTreeNode(entry: $0, entries: entries) }

    if !children.isEmpty {
        node["children"] = children
    }

    return node
}

private func isDirectChildPath(_ path: [Int], of parentPath: [Int]) -> Bool {
    guard path.count == parentPath.count + 1 else {
        return false
    }

    return Array(path.dropLast()) == parentPath
}

private func decodeAXPath(_ path: String) -> [Int]? {
    if path == "root" {
        return []
    }

    let parts = path.split(separator: ".")
    let decoded = parts.compactMap { Int($0) }
    return decoded.count == parts.count ? decoded : nil
}

private func findFocusedElementId(elements: [[String: Any]]) -> String? {
    for element in elements {
        if let metadata = element["metadata"] as? [String: Any],
           let focused = metadata["focused"] as? Bool,
           focused,
           let id = element["id"] as? String {
            return id
        }
    }
    return nil
}

private func findFocusedWindow(windows: [[String: Any]], target: [String: Any]) -> [String: Any]? {
    guard let app = findRunningApp(target: target) else {
        return nil
    }

    // Check if app is frontmost
    let isFrontmost = NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier

    if isFrontmost, let firstWindow = windows.first {
        var focusedWin = firstWindow
        focusedWin["focused"] = true
        return focusedWin
    }

    return nil
}

private func collectAXElement(
    _ element: AXUIElement,
    target: [String: Any],
    app: NSRunningApplication,
    path: [Int],
    depth: Int,
    elements: inout [[String: Any]]
) {
    if elements.count >= maxAXElements || depth > maxAXDepth {
        return
    }

    let role = axString(element, kAXRoleAttribute)
    if isIgnoredAXRole(role) {
        return
    }

    if let snapshot = axElementSnapshot(element: element, target: target, app: app, path: path) {
        elements.append(snapshot)
    }

    guard depth < maxAXDepth, let children = axChildren(element) else {
        return
    }

    for (index, child) in children.enumerated() {
        if elements.count >= maxAXElements {
            return
        }

        collectAXElement(
            child,
            target: target,
            app: app,
            path: path + [index],
            depth: depth + 1,
            elements: &elements
        )
    }
}

private func axElementSnapshot(
    element: AXUIElement,
    target: [String: Any],
    app: NSRunningApplication,
    path: [Int]
) -> [String: Any]? {
    let role = axString(element, kAXRoleAttribute)
    let title = axString(element, kAXTitleAttribute)
    let description = axString(element, kAXDescriptionAttribute)
    let roleDescription = axString(element, kAXRoleDescriptionAttribute)
    let value = axString(element, kAXValueAttribute)
    let identifier = axString(element, "AXIdentifier")
    let name = firstNonEmpty([title, description, value, identifier])

    if role == nil && name == nil {
        return nil
    }

    let pathString = encodeAXPath(path)
    var metadata: [String: Any] = [
        "pid": Int(app.processIdentifier),
        "path": pathString,
    ]

    if let bundleId = app.bundleIdentifier {
        metadata["bundleId"] = bundleId
    }
    if let identifier {
        metadata["axIdentifier"] = identifier
    }
    if let roleDescription {
        metadata["roleDescription"] = roleDescription
    }
    if let value, value != name {
        metadata["value"] = value
    }
    if let enabled = axBool(element, kAXEnabledAttribute) {
        metadata["enabled"] = enabled
    }
    if let focused = axBool(element, kAXFocusedAttribute) {
        metadata["focused"] = focused
    }
    if let frame = axFrame(element) {
        metadata["frame"] = frame
    }

    var snapshot: [String: Any] = [
        "id": axElementId(app: app, path: pathString),
        "source": "mac-helper",
        "target": target,
        "metadata": metadata,
    ]

    if let role {
        snapshot["role"] = role
    }
    if let name {
        snapshot["name"] = name
    }

    return snapshot
}

private func performOpen(action: [String: Any], actionId: String, method: String) -> [String: Any] {
    guard let target = actionTarget(action) else {
        return failedActionResult(
            actionId: actionId,
            method: method,
            code: "INVALID_TARGET",
            message: "open requires action.target."
        )
    }

    guard let appURL = appBundleURL(target: target) else {
        return failedActionResult(
            actionId: actionId,
            method: method,
            code: "TARGET_NOT_FOUND",
            message: "Target app bundle could not be resolved."
        )
    }

    let input = action["input"] as? [String: Any] ?? [:]
    let filePath = nonEmptyString(input["filePath"])
    let configuration = NSWorkspace.OpenConfiguration()
    configuration.activates = true

    let semaphore = DispatchSemaphore(value: 0)
    let openError = OpenErrorBox()

    if let filePath {
        let fileURL = URL(fileURLWithPath: filePath)
        NSWorkspace.shared.open([fileURL], withApplicationAt: appURL, configuration: configuration) { _, error in
            openError.error = error
            semaphore.signal()
        }
    } else {
        NSWorkspace.shared.openApplication(at: appURL, configuration: configuration) { _, error in
            openError.error = error
            semaphore.signal()
        }
    }

    _ = semaphore.wait(timeout: .now() + 5)

    if let error = openError.error {
        return failedActionResult(
            actionId: actionId,
            method: method,
            code: "ACTION_FAILED",
            message: "Unable to open target app.",
            details: ["error": error.localizedDescription]
        )
    }

    usleep(800_000)

    var metadata: [String: Any] = [
        "bundleURL": appURL.path,
    ]
    if let filePath {
        metadata["filePath"] = filePath
    }

    return passedActionResult(actionId: actionId, method: method, metadata: metadata)
}

private func performClick(action: [String: Any], actionId: String, method: String) -> [String: Any] {
    guard let target = actionTarget(action),
          let app = findRunningApp(target: target)
    else {
        return failedActionResult(
            actionId: actionId,
            method: method,
            code: "TARGET_NOT_FOUND",
            message: "Target app is not running."
        )
    }

    if let point = actionPoint(action) {
        activateTargetApp(app)

        if postMouseClickToHidWhenFrontmost(app.processIdentifier, point: point) {
            return passedActionResult(
                actionId: actionId,
                method: method,
                metadata: ["inputMethod": "verified-hid-point", "x": point.x, "y": point.y]
            )
        }

        return failedActionResult(
            actionId: actionId,
            method: method,
            code: "ACTION_FAILED",
            message: "Refusing point click because target app is not the front layer-zero window at that point.",
            details: ["x": point.x, "y": point.y]
        )
    }

    guard let element = resolveActionElement(action, expectedPid: app.processIdentifier) else {
        return failedActionResult(
            actionId: actionId,
            method: method,
            code: "ELEMENT_NOT_FOUND",
            message: "click requires a resolvable action.element."
        )
    }

    let error = AXUIElementPerformAction(element, kAXPressAction as CFString)
    if error == .success {
        return passedActionResult(actionId: actionId, method: method)
    }

    if isQQMusicTarget(target) {
        activateTargetApp(app)

        if clickElementCenterToHidWhenFrontmost(element, pid: app.processIdentifier) {
            return passedActionResult(
                actionId: actionId,
                method: method,
                metadata: ["inputMethod": "qqmusic-verified-hid-mouse"]
            )
        }
    }

    if isQQMusicTarget(target), clickElementCenterToPid(element, pid: app.processIdentifier) {
        return passedActionResult(
            actionId: actionId,
            method: method,
            metadata: ["inputMethod": "qqmusic-pid-mouse"]
        )
    }

    return failedActionResult(
        actionId: actionId,
        method: method,
        code: "ACTION_FAILED",
        message: "AXPress failed for action.element.",
        details: ["axError": String(describing: error)]
    )
}

private func performSecondaryClick(action: [String: Any], actionId: String, method: String) -> [String: Any] {
    guard let target = actionTarget(action),
          let app = findRunningApp(target: target)
    else {
        return failedActionResult(
            actionId: actionId,
            method: method,
            code: "TARGET_NOT_FOUND",
            message: "Target app is not running."
        )
    }

    guard let point = actionPoint(action) ?? actionElementCenter(action, expectedPid: app.processIdentifier) else {
        return failedActionResult(
            actionId: actionId,
            method: method,
            code: "ELEMENT_NOT_FOUND",
            message: "secondary-click requires a resolvable point or action.element."
        )
    }

    activateTargetApp(app)

    guard postMouseButtonToHidWhenFrontmost(
        app.processIdentifier,
        point: point,
        button: .right,
        downType: .rightMouseDown,
        upType: .rightMouseUp
    ) else {
        return failedActionResult(
            actionId: actionId,
            method: method,
            code: "ACTION_FAILED",
            message: "Refusing secondary click because target app is not the front layer-zero window at that point.",
            details: ["x": point.x, "y": point.y]
        )
    }

    return passedActionResult(
        actionId: actionId,
        method: method,
        metadata: ["inputMethod": "verified-hid-secondary-click", "x": point.x, "y": point.y]
    )
}

private func performHover(action: [String: Any], actionId: String, method: String) -> [String: Any] {
    guard let target = actionTarget(action),
          let app = findRunningApp(target: target)
    else {
        return failedActionResult(
            actionId: actionId,
            method: method,
            code: "TARGET_NOT_FOUND",
            message: "Target app is not running."
        )
    }

    guard let point = actionPoint(action) ?? actionElementCenter(action, expectedPid: app.processIdentifier) else {
        return failedActionResult(
            actionId: actionId,
            method: method,
            code: "ELEMENT_NOT_FOUND",
            message: "hover requires a resolvable point or action.element."
        )
    }

    activateTargetApp(app)

    guard postMouseMoveToHidWhenFrontmost(app.processIdentifier, point: point) else {
        return failedActionResult(
            actionId: actionId,
            method: method,
            code: "ACTION_FAILED",
            message: "Refusing hover because target app is not the front layer-zero window at that point.",
            details: ["x": point.x, "y": point.y]
        )
    }

    return passedActionResult(
        actionId: actionId,
        method: method,
        metadata: ["inputMethod": "verified-hid-hover", "x": point.x, "y": point.y]
    )
}

private func performDrag(action: [String: Any], actionId: String, method: String) -> [String: Any] {
    guard let target = actionTarget(action),
          let app = findRunningApp(target: target)
    else {
        return failedActionResult(
            actionId: actionId,
            method: method,
            code: "TARGET_NOT_FOUND",
            message: "Target app is not running."
        )
    }

    guard let start = actionPoint(action) ?? actionElementCenter(action, expectedPid: app.processIdentifier),
          let end = dragEndPoint(action, start: start)
    else {
        return failedActionResult(
            actionId: actionId,
            method: method,
            code: "INVALID_REQUEST",
            message: "drag requires a resolvable start point and destination."
        )
    }

    activateTargetApp(app)

    guard postMouseDragToHidWhenFrontmost(app.processIdentifier, from: start, to: end) else {
        return failedActionResult(
            actionId: actionId,
            method: method,
            code: "ACTION_FAILED",
            message: "Refusing drag because target app is not the front layer-zero window at the start point.",
            details: ["fromX": start.x, "fromY": start.y, "toX": end.x, "toY": end.y]
        )
    }

    return passedActionResult(
        actionId: actionId,
        method: method,
        metadata: [
            "inputMethod": "verified-hid-drag",
            "fromX": start.x,
            "fromY": start.y,
            "toX": end.x,
            "toY": end.y,
        ]
    )
}

private func performType(action: [String: Any], actionId: String, method: String, text: String) -> [String: Any] {
    guard let target = actionTarget(action),
          let app = findRunningApp(target: target)
    else {
        return failedActionResult(
            actionId: actionId,
            method: method,
            code: "TARGET_NOT_FOUND",
            message: "Target app is not running."
        )
    }

    guard let element = resolveActionElement(action, expectedPid: app.processIdentifier) else {
        return failedActionResult(
            actionId: actionId,
            method: method,
            code: "ELEMENT_NOT_FOUND",
            message: "type requires a resolvable action.element."
        )
    }

    let role = axString(element, kAXRoleAttribute)
    focusElement(element)

    if isTextInputAXRole(role) {
        if isAXAttributeSettable(element, kAXValueAttribute) {
            let error = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, text as CFTypeRef)
            if error == .success {
                return passedActionResult(actionId: actionId, method: method, metadata: ["text": text])
            }
        }

        activateTargetApp(app)
        focusElement(element)
        usleep(200_000)

        if pasteTextToPid(app.processIdentifier, text: text) {
            return passedActionResult(
                actionId: actionId,
                method: method,
                metadata: ["text": text, "inputMethod": "text-input-paste"]
            )
        }

        return failedActionResult(
            actionId: actionId,
            method: method,
            code: "ACTION_FAILED",
            message: "Unable to paste text into text AX element.",
            details: ["role": role ?? "unknown"]
        )
    }

    if isSublimeTextTarget(target) {
        activateTargetApp(app)
        usleep(200_000)

        guard pasteTextToPid(app.processIdentifier, text: text) else {
            return failedActionResult(
                actionId: actionId,
                method: method,
                code: "ACTION_FAILED",
                message: "Unable to paste text into Sublime Text.",
                details: ["role": role ?? "unknown"]
            )
        }

        return passedActionResult(
            actionId: actionId,
            method: method,
            metadata: ["text": text, "inputMethod": "sublime-text-pid-paste"]
        )
    }

    guard isQQMusicTarget(target), isQQMusicSearchElement(element) else {
        return failedActionResult(
            actionId: actionId,
            method: method,
            code: "ACTION_FAILED",
            message: "Refusing to type into non-text AX element without an app-specific adapter.",
            details: ["role": role ?? "unknown"]
        )
    }

    activateTargetApp(app)
    let focusedByMouse = clickElementCenterToHidWhenFrontmost(element, pid: app.processIdentifier)

    guard focusedByMouse else {
        return failedActionResult(
            actionId: actionId,
            method: method,
            code: "ACTION_FAILED",
            message: "Unable to focus QQ Music search element.",
            details: ["role": axString(element, kAXRoleAttribute) ?? "unknown"]
        )
    }

    usleep(200_000)

    guard pasteTextToPid(app.processIdentifier, text: text) else {
        return failedActionResult(
            actionId: actionId,
            method: method,
            code: "ACTION_FAILED",
            message: "Unable to paste text into QQ Music search element.",
            details: ["role": axString(element, kAXRoleAttribute) ?? "unknown"]
        )
    }

    return passedActionResult(
        actionId: actionId,
        method: method,
        metadata: ["text": text, "inputMethod": "qqmusic-pid-paste"]
    )
}

private func performKey(action: [String: Any], actionId: String, method: String, key: String) -> [String: Any] {
    guard let target = actionTarget(action) else {
        return failedActionResult(
            actionId: actionId,
            method: method,
            code: "INVALID_TARGET",
            message: "key requires action.target."
        )
    }

    guard let app = findRunningApp(target: target) else {
        return failedActionResult(
            actionId: actionId,
            method: method,
            code: "TARGET_NOT_FOUND",
            message: "Target app is not running."
        )
    }

    guard let keyChord = macKeyChord(key) else {
        return failedActionResult(
            actionId: actionId,
            method: method,
            code: "INVALID_REQUEST",
            message: "Unsupported key '\(key)'."
        )
    }

    if !keyChord.flags.isEmpty {
        activateTargetApp(app)

        if postKeyChordToPid(app.processIdentifier, chord: keyChord) {
            return passedActionResult(
                actionId: actionId,
                method: method,
                metadata: ["key": key, "inputMethod": "key-chord"]
            )
        }

        return failedActionResult(
            actionId: actionId,
            method: method,
            code: "ACTION_FAILED",
            message: "Unable to post key chord to target app.",
            details: ["key": key]
        )
    }

    let keyCode = keyChord.keyCode

    if isQQMusicTarget(target) {
        activateTargetApp(app)

        if let element = resolveActionElement(action, expectedPid: app.processIdentifier),
           isQQMusicSearchElement(element)
        {
            _ = clickElementCenterToHidWhenFrontmost(element, pid: app.processIdentifier)
            usleep(200_000)
        }

        if postKeyToHidWhenFrontmost(app.processIdentifier, keyCode: keyCode) {
            return passedActionResult(
                actionId: actionId,
                method: method,
                metadata: ["key": key, "inputMethod": "qqmusic-verified-hid-key"]
            )
        }
    }

    guard
        let down = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: true),
        let up = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: false)
    else {
        return failedActionResult(
            actionId: actionId,
            method: method,
            code: "ACTION_FAILED",
            message: "Could not create keyboard event for key '\(key)'."
        )
    }

    down.postToPid(app.processIdentifier)
    up.postToPid(app.processIdentifier)
    usleep(500_000)

    return passedActionResult(actionId: actionId, method: method, metadata: ["key": key])
}

private func performScroll(
    action: [String: Any],
    actionId: String,
    method: String,
    direction: String,
    amount: Double
) -> [String: Any] {
    guard let target = actionTarget(action),
          let app = findRunningApp(target: target)
    else {
        return failedActionResult(
            actionId: actionId,
            method: method,
            code: "TARGET_NOT_FOUND",
            message: "Target app is not running."
        )
    }

    var scrollElement: AXUIElement? = resolveActionElement(action, expectedPid: app.processIdentifier)

    if scrollElement == nil {
        let root = AXUIElementCreateApplication(app.processIdentifier)
        var focusedRef: CFTypeRef?
        let error = AXUIElementCopyAttributeValue(root, kAXFocusedUIElementAttribute as CFString, &focusedRef)
        if error == .success, let focused = focusedRef {
            scrollElement = focused as! AXUIElement
        }
    }

    let scrollAmount = max(1, Int32((amount * 10).rounded()))
    let (deltaX, deltaY): (Int32, Int32) = {
        switch direction {
        case "up":
            return (0, scrollAmount)
        case "down":
            return (0, -scrollAmount)
        case "left":
            return (scrollAmount, 0)
        case "right":
            return (-scrollAmount, 0)
        default:
            return (0, 0)
        }
    }()

    activateTargetApp(app)

    guard let scrollEvent = CGEvent(
        scrollWheelEvent2Source: nil,
        units: .pixel,
        wheelCount: 2,
        wheel1: deltaY,
        wheel2: deltaX,
        wheel3: 0
    ) else {
        return failedActionResult(
            actionId: actionId,
            method: method,
            code: "ACTION_FAILED",
            message: "Failed to create scroll event."
        )
    }

    var metadata: [String: Any] = [
        "direction": direction,
        "amount": amount,
        "deltaX": deltaX,
        "deltaY": deltaY,
        "inputMethod": "scroll-wheel",
    ]

    if let element = scrollElement, let center = axElementCenter(element) {
        scrollEvent.location = center
        metadata["x"] = center.x
        metadata["y"] = center.y
    }

    scrollEvent.postToPid(app.processIdentifier)
    usleep(200_000)

    return passedActionResult(
        actionId: actionId,
        method: method,
        metadata: metadata
    )
}

private func focusElement(_ element: AXUIElement) {
    _ = AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue)
    _ = AXUIElementPerformAction(element, kAXPressAction as CFString)
}

private func actionTarget(_ action: [String: Any]) -> [String: Any]? {
    return action["target"] as? [String: Any]
}

private func validateActionRequest(
    action: [String: Any],
    params: [String: Any],
    method: String,
    actionId: String
) -> [String: Any]? {
    guard nonEmptyString(action["kind"]) == method else {
        return failedActionResult(
            actionId: actionId,
            method: method,
            code: "INVALID_REQUEST",
            message: "action.kind must match method '\(method)'."
        )
    }

    guard let target = action["target"] as? [String: Any] else {
        return failedActionResult(
            actionId: actionId,
            method: method,
            code: "INVALID_TARGET",
            message: "action.target is required."
        )
    }

    if let targetFailure = validateActionTarget(target: target, actionId: actionId, method: method) {
        return targetFailure
    }

    switch method {
    case "open":
        break
    case "click":
        if !hasElement(action) && !hasPointInput(action) {
            return failedActionResult(
                actionId: actionId,
                method: method,
                code: "INVALID_REQUEST",
                message: "click requires action.element or numeric action.input.x/y."
            )
        }
    case "secondary-click", "hover":
        if !hasElement(action) && !hasPointInput(action) {
            return failedActionResult(
                actionId: actionId,
                method: method,
                code: "INVALID_REQUEST",
                message: "\(method) requires action.element or numeric action.input.x/y."
            )
        }
    case "drag":
        if !hasElement(action) && !hasPointInput(action) {
            return failedActionResult(
                actionId: actionId,
                method: method,
                code: "INVALID_REQUEST",
                message: "drag requires action.element or numeric action.input.x/y as a start point."
            )
        }

        if !hasDragDestination(action) {
            return failedActionResult(
                actionId: actionId,
                method: method,
                code: "INVALID_REQUEST",
                message: "drag requires numeric action.input.toX/toY or deltaX/deltaY."
            )
        }
    case "type":
        if nonEmptyString(params["text"]) == nil {
            return failedActionResult(
                actionId: actionId,
                method: method,
                code: "INVALID_REQUEST",
                message: "type params.text is required."
            )
        }
    case "key":
        if nonEmptyString(params["key"]) == nil {
            return failedActionResult(
                actionId: actionId,
                method: method,
                code: "INVALID_REQUEST",
                message: "key params.key is required."
            )
        }
    case "scroll":
        if !["up", "down", "left", "right"].contains(nonEmptyString(params["direction"]) ?? "") {
            return failedActionResult(
                actionId: actionId,
                method: method,
                code: "INVALID_REQUEST",
                message: "scroll params.direction must be up, down, left, or right."
            )
        }

        if let amount = params["amount"], !isPositiveNumber(amount) {
            return failedActionResult(
                actionId: actionId,
                method: method,
                code: "INVALID_REQUEST",
                message: "scroll params.amount must be a positive number."
            )
        }
    default:
        return failedActionResult(
            actionId: actionId,
            method: method,
            code: "INVALID_REQUEST",
            message: "Unsupported action method '\(method)'."
        )
    }

    return nil
}

private func validateActionTarget(target: [String: Any], actionId: String, method: String) -> [String: Any]? {
    guard let kind = nonEmptyString(target["kind"]) else {
        return failedActionResult(
            actionId: actionId,
            method: method,
            code: "INVALID_TARGET",
            message: "target.kind is required."
        )
    }

    if kind == "screen" {
        return nil
    }

    guard kind == "app" else {
        return failedActionResult(
            actionId: actionId,
            method: method,
            code: "INVALID_TARGET",
            message: "mac-helper actions only support app or screen targets.",
            details: ["targetKind": kind]
        )
    }

    if nonEmptyString(target["id"]) == nil && nonEmptyString(target["name"]) == nil {
        return failedActionResult(
            actionId: actionId,
            method: method,
            code: "INVALID_TARGET",
            message: "app target requires id or name."
        )
    }

    return nil
}

private func findRunningApp(target: [String: Any]) -> NSRunningApplication? {
    let targetId = nonEmptyString(target["id"])?.lowercased()
    let targetName = nonEmptyString(target["name"])?.lowercased()
    let apps = NSWorkspace.shared.runningApplications

    if let targetId,
       let app = apps.first(where: { $0.bundleIdentifier?.lowercased() == targetId })
    {
        return app
    }

    if let targetName {
        return apps.first { app in
            guard let name = app.localizedName?.lowercased() else {
                return false
            }

            return name == targetName || name.contains(targetName) || targetName.contains(name)
        }
    }

    return nil
}

private func appBundleURL(target: [String: Any]) -> URL? {
    if let app = findRunningApp(target: target),
       let bundleURL = app.bundleURL
    {
        return bundleURL
    }

    if let targetId = nonEmptyString(target["id"]),
       let bundleURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: targetId)
    {
        return bundleURL
    }

    let targetName = nonEmptyString(target["name"])?.lowercased()
    guard let targetName else {
        return nil
    }

    return NSWorkspace.shared.runningApplications.first { app in
        guard let name = app.localizedName?.lowercased() else {
            return false
        }

        return name == targetName || name.contains(targetName) || targetName.contains(name)
    }?.bundleURL
}

private func resolveActionElement(_ action: [String: Any], expectedPid: pid_t? = nil) -> AXUIElement? {
    guard
        let element = action["element"] as? [String: Any],
        let id = nonEmptyString(element["id"]),
        let ref = decodeAXElementId(id)
    else {
        return nil
    }

    if let expectedPid, ref.pid != expectedPid {
        return nil
    }

    let root = AXUIElementCreateApplication(ref.pid)
    var current = root

    for index in ref.path {
        guard let children = axChildren(current), children.indices.contains(index) else {
            return nil
        }

        current = children[index]
    }

    return current
}

private func isQQMusicTarget(_ target: [String: Any]) -> Bool {
    return nonEmptyString(target["id"])?.lowercased() == "com.tencent.qqmusicmac"
}

private func isSublimeTextTarget(_ target: [String: Any]) -> Bool {
    return nonEmptyString(target["id"])?.lowercased() == "com.sublimetext.4"
}

private func isQQMusicSearchElement(_ element: AXUIElement) -> Bool {
    let role = axString(element, kAXRoleAttribute)
    let name = firstNonEmpty([
        axString(element, kAXTitleAttribute),
        axString(element, kAXDescriptionAttribute),
        axString(element, kAXValueAttribute),
        axString(element, "AXIdentifier"),
    ])

    return role == "AXUnknown" && name == "搜索"
}

private func activateTargetApp(_ app: NSRunningApplication) {
    if let bundleURL = app.bundleURL {
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true

        let semaphore = DispatchSemaphore(value: 0)
        NSWorkspace.shared.openApplication(at: bundleURL, configuration: configuration) { _, _ in
            semaphore.signal()
        }
        _ = semaphore.wait(timeout: .now() + 2)
    } else {
        app.activate()
    }

    usleep(300_000)
}

private func clickElementCenterToPid(_ element: AXUIElement, pid: pid_t) -> Bool {
    guard let frame = axFrame(element),
          let x = frame["x"] as? CGFloat,
          let y = frame["y"] as? CGFloat,
          let width = frame["width"] as? CGFloat,
          let height = frame["height"] as? CGFloat,
          width > 0,
          height > 0
    else {
        return false
    }

    return postMouseClickToPid(pid, point: CGPoint(x: x + width / 2, y: y + height / 2))
}

private func clickElementCenterToHidWhenFrontmost(_ element: AXUIElement, pid: pid_t) -> Bool {
    guard let point = axElementCenter(element)
    else {
        return false
    }

    return postMouseClickToHidWhenFrontmost(pid, point: point)
}

private func axElementCenter(_ element: AXUIElement) -> CGPoint? {
    guard let frame = axFrame(element),
          let x = frame["x"] as? CGFloat,
          let y = frame["y"] as? CGFloat,
          let width = frame["width"] as? CGFloat,
          let height = frame["height"] as? CGFloat,
          width > 0,
          height > 0
    else {
        return nil
    }

    return CGPoint(x: x + width / 2, y: y + height / 2)
}

private func postMouseClickToPid(_ pid: pid_t, point: CGPoint) -> Bool {
    guard
        let down = CGEvent(
            mouseEventSource: nil,
            mouseType: .leftMouseDown,
            mouseCursorPosition: point,
            mouseButton: .left
        ),
        let up = CGEvent(
            mouseEventSource: nil,
            mouseType: .leftMouseUp,
            mouseCursorPosition: point,
            mouseButton: .left
        )
    else {
        return false
    }

    down.postToPid(pid)
    up.postToPid(pid)
    usleep(150_000)

    return true
}

private func postMouseClickToHidWhenFrontmost(_ pid: pid_t, point: CGPoint) -> Bool {
    return postMouseButtonToHidWhenFrontmost(
        pid,
        point: point,
        button: .left,
        downType: .leftMouseDown,
        upType: .leftMouseUp
    )
}

private func postMouseButtonToHidWhenFrontmost(
    _ pid: pid_t,
    point: CGPoint,
    button: CGMouseButton,
    downType: CGEventType,
    upType: CGEventType
) -> Bool {
    guard frontLayerZeroWindowPid(at: point) == pid else {
        return false
    }

    guard
        let down = CGEvent(
            mouseEventSource: nil,
            mouseType: downType,
            mouseCursorPosition: point,
            mouseButton: button
        ),
        let up = CGEvent(
            mouseEventSource: nil,
            mouseType: upType,
            mouseCursorPosition: point,
            mouseButton: button
        )
    else {
        return false
    }

    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
    usleep(150_000)

    return true
}

private func postMouseMoveToHidWhenFrontmost(_ pid: pid_t, point: CGPoint) -> Bool {
    guard frontLayerZeroWindowPid(at: point) == pid else {
        return false
    }

    guard let move = CGEvent(
        mouseEventSource: nil,
        mouseType: .mouseMoved,
        mouseCursorPosition: point,
        mouseButton: .left
    ) else {
        return false
    }

    move.post(tap: .cghidEventTap)
    usleep(100_000)

    return true
}

private func postMouseDragToHidWhenFrontmost(_ pid: pid_t, from start: CGPoint, to end: CGPoint) -> Bool {
    guard frontLayerZeroWindowPid(at: start) == pid else {
        return false
    }

    guard
        let down = CGEvent(
            mouseEventSource: nil,
            mouseType: .leftMouseDown,
            mouseCursorPosition: start,
            mouseButton: .left
        ),
        let drag = CGEvent(
            mouseEventSource: nil,
            mouseType: .leftMouseDragged,
            mouseCursorPosition: end,
            mouseButton: .left
        ),
        let up = CGEvent(
            mouseEventSource: nil,
            mouseType: .leftMouseUp,
            mouseCursorPosition: end,
            mouseButton: .left
        )
    else {
        return false
    }

    down.post(tap: .cghidEventTap)
    usleep(100_000)
    drag.post(tap: .cghidEventTap)
    usleep(150_000)
    up.post(tap: .cghidEventTap)
    usleep(200_000)

    return true
}

private func frontLayerZeroWindowPid(at point: CGPoint) -> pid_t? {
    guard
        let rawWindows = CGWindowListCopyWindowInfo(
            [.optionOnScreenOnly, .excludeDesktopElements],
            kCGNullWindowID
        ) as? [[String: Any]]
    else {
        return nil
    }

    for window in rawWindows {
        guard let layer = window[kCGWindowLayer as String] as? Int, layer == 0,
              let pid = window[kCGWindowOwnerPID as String] as? pid_t,
              let bounds = window[kCGWindowBounds as String] as? [String: Any],
              let x = bounds["X"] as? CGFloat,
              let y = bounds["Y"] as? CGFloat,
              let width = bounds["Width"] as? CGFloat,
              let height = bounds["Height"] as? CGFloat,
              CGRect(x: x, y: y, width: width, height: height).contains(point)
        else {
            continue
        }

        return pid
    }

    return nil
}

private func decodeAXElementId(_ id: String) -> (pid: pid_t, path: [Int])? {
    let parts = id.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
    guard parts.count == 4, parts[0] == "ax", let pid = Int32(parts[2]) else {
        return nil
    }

    if parts[3] == "root" {
        return (pid: pid, path: [])
    }

    let path = parts[3].split(separator: ".").compactMap { Int($0) }
    guard !path.isEmpty || parts[3].isEmpty else {
        return nil
    }

    return (pid: pid, path: path)
}

private func axElementId(app: NSRunningApplication, path: String) -> String {
    let bundleId = app.bundleIdentifier ?? "unknown"
    return "ax:\(bundleId):\(app.processIdentifier):\(path)"
}

private func isIgnoredAXRole(_ role: String?) -> Bool {
    switch role {
    case "AXMenuBar", "AXMenu", "AXMenuItem":
        return true
    default:
        return false
    }
}

private func isTextInputAXRole(_ role: String?) -> Bool {
    switch role {
    case "AXTextField", "AXTextArea", "AXTextView", "AXSearchField":
        return true
    default:
        return false
    }
}

private func isAXAttributeSettable(_ element: AXUIElement, _ attribute: String) -> Bool {
    var settable = DarwinBoolean(false)
    let error = AXUIElementIsAttributeSettable(element, attribute as CFString, &settable)
    return error == .success && settable.boolValue
}

private struct PasteboardSnapshot {
    let items: [[NSPasteboard.PasteboardType: Data]]

    static func capture(_ pasteboard: NSPasteboard = .general) -> PasteboardSnapshot {
        let items = pasteboard.pasteboardItems?.map { item -> [NSPasteboard.PasteboardType: Data] in
            var dataByType: [NSPasteboard.PasteboardType: Data] = [:]

            for type in item.types {
                if let data = item.data(forType: type) {
                    dataByType[type] = data
                }
            }

            return dataByType
        } ?? []

        return PasteboardSnapshot(items: items)
    }

    func restore(_ pasteboard: NSPasteboard = .general) {
        pasteboard.clearContents()

        let restoredItems = items.map { dataByType in
            let item = NSPasteboardItem()

            for (type, data) in dataByType {
                item.setData(data, forType: type)
            }

            return item
        }

        if !restoredItems.isEmpty {
            pasteboard.writeObjects(restoredItems)
        }
    }
}

private func pasteTextToPid(_ pid: pid_t, text: String) -> Bool {
    let pasteboard = NSPasteboard.general
    let snapshot = PasteboardSnapshot.capture(pasteboard)

    pasteboard.clearContents()
    guard pasteboard.setString(text, forType: .string) else {
        snapshot.restore(pasteboard)
        return false
    }

    _ = postKeyboardShortcutToPid(pid, keyCode: 0)
    usleep(100_000)

    let posted = postKeyboardShortcutToPid(pid, keyCode: 9)
    usleep(300_000)
    snapshot.restore(pasteboard)

    return posted
}

private func postKeyboardShortcutToPid(_ pid: pid_t, keyCode: CGKeyCode) -> Bool {
    guard
        let commandDown = CGEvent(keyboardEventSource: nil, virtualKey: 55, keyDown: true),
        let keyDown = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: true),
        let keyUp = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: false),
        let commandUp = CGEvent(keyboardEventSource: nil, virtualKey: 55, keyDown: false)
    else {
        return false
    }

    keyDown.flags = .maskCommand
    keyUp.flags = .maskCommand

    commandDown.postToPid(pid)
    keyDown.postToPid(pid)
    keyUp.postToPid(pid)
    commandUp.postToPid(pid)

    return true
}

private func postKeyChordToPid(_ pid: pid_t, chord: KeyChord) -> Bool {
    if chord.flags == CGEventFlags.maskCommand {
        return postKeyboardShortcutToPid(pid, keyCode: chord.keyCode)
    }

    guard
        let down = CGEvent(keyboardEventSource: nil, virtualKey: chord.keyCode, keyDown: true),
        let up = CGEvent(keyboardEventSource: nil, virtualKey: chord.keyCode, keyDown: false)
    else {
        return false
    }

    down.flags = chord.flags
    up.flags = chord.flags
    down.postToPid(pid)
    up.postToPid(pid)
    usleep(300_000)

    return true
}

private func postKeyToHidWhenFrontmost(_ pid: pid_t, keyCode: CGKeyCode) -> Bool {
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else {
        return false
    }

    guard
        let down = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: true),
        let up = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: false)
    else {
        return false
    }

    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
    usleep(500_000)

    return true
}

private func sendTextToPid(_ pid: pid_t, text: String) -> Bool {
    let characters = Array(text.utf16)
    guard !characters.isEmpty else {
        return true
    }

    for character in characters {
        var scalar = character
        guard
            let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
            let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false)
        else {
            return false
        }

        down.keyboardSetUnicodeString(stringLength: 1, unicodeString: &scalar)
        up.keyboardSetUnicodeString(stringLength: 1, unicodeString: &scalar)
        down.postToPid(pid)
        up.postToPid(pid)
        usleep(25_000)
    }

    return true
}

private func encodeAXPath(_ path: [Int]) -> String {
    if path.isEmpty {
        return "root"
    }

    return path.map(String.init).joined(separator: ".")
}

private func axChildren(_ element: AXUIElement) -> [AXUIElement]? {
    var value: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &value)
    guard error == .success, let children = value as? [AXUIElement] else {
        return nil
    }

    return children
}

private func axString(_ element: AXUIElement, _ attribute: String) -> String? {
    var value: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    guard error == .success, let raw = value else {
        return nil
    }

    if let string = raw as? String {
        return nonEmptyString(string)
    }

    if let number = raw as? NSNumber {
        return String(describing: number)
    }

    return nil
}

private func axBool(_ element: AXUIElement, _ attribute: String) -> Bool? {
    var value: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    guard error == .success, let number = value as? NSNumber else {
        return nil
    }

    return number.boolValue
}

private func axFrame(_ element: AXUIElement) -> [String: Any]? {
    guard
        let position = axCGPoint(element, kAXPositionAttribute),
        let size = axCGSize(element, kAXSizeAttribute)
    else {
        return nil
    }

    return [
        "x": position.x,
        "y": position.y,
        "width": size.width,
        "height": size.height,
    ]
}

private func axCGPoint(_ element: AXUIElement, _ attribute: String) -> CGPoint? {
    var value: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    guard error == .success, let axValue = value else {
        return nil
    }

    var point = CGPoint.zero
    guard AXValueGetType(axValue as! AXValue) == .cgPoint,
          AXValueGetValue(axValue as! AXValue, .cgPoint, &point)
    else {
        return nil
    }

    return point
}

private func axCGSize(_ element: AXUIElement, _ attribute: String) -> CGSize? {
    var value: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    guard error == .success, let axValue = value else {
        return nil
    }

    var size = CGSize.zero
    guard AXValueGetType(axValue as! AXValue) == .cgSize,
          AXValueGetValue(axValue as! AXValue, .cgSize, &size)
    else {
        return nil
    }

    return size
}

private func firstNonEmpty(_ values: [String?]) -> String? {
    return values.compactMap { nonEmptyString($0) }.first
}

private struct KeyChord {
    let keyCode: CGKeyCode
    let flags: CGEventFlags
}

private func macKeyChord(_ key: String) -> KeyChord? {
    let parts = key
        .split(separator: "+")
        .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        .filter { !$0.isEmpty }

    guard let baseKey = parts.last,
          let keyCode = macKeyCode(baseKey)
    else {
        return nil
    }

    var flags = CGEventFlags()
    for modifier in parts.dropLast() {
        switch modifier {
        case "command", "cmd", "meta":
            flags.insert(.maskCommand)
        case "shift":
            flags.insert(.maskShift)
        case "option", "alt":
            flags.insert(.maskAlternate)
        case "control", "ctrl":
            flags.insert(.maskControl)
        default:
            return nil
        }
    }

    return KeyChord(keyCode: keyCode, flags: flags)
}

private func macKeyCode(_ key: String) -> CGKeyCode? {
    switch key.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
    case "a":
        return 0
    case "s":
        return 1
    case "d":
        return 2
    case "f":
        return 3
    case "g":
        return 5
    case "c":
        return 8
    case "v":
        return 9
    case "n":
        return 45
    case "enter", "return":
        return 36
    case "escape", "esc":
        return 53
    case "tab":
        return 48
    default:
        return nil
    }
}

private func readTarget(params: [String: Any]) -> [String: Any] {
    if let target = params["target"] as? [String: Any] {
        return target
    }

    if let action = params["action"] as? [String: Any],
       let target = action["target"] as? [String: Any]
    {
        return target
    }

    return [
        "kind": "app",
        "platform": "macos",
    ]
}

private func failedActionResult(
    actionId: String,
    method: String,
    code: String,
    message: String,
    details: [String: Any] = [:]
) -> [String: Any] {
    var error: [String: Any] = [
        "code": code,
        "message": message,
    ]

    if !details.isEmpty {
        error["details"] = details
    }

    return [
        "actionId": actionId,
        "ok": false,
        "status": code == "POLICY_BLOCKED" ? "blocked" : "failed",
        "adapter": "mac-helper",
        "error": error,
        "metadata": [
            "helperMethod": method,
        ],
    ]
}

private func passedActionResult(
    actionId: String,
    method: String,
    metadata extraMetadata: [String: Any] = [:]
) -> [String: Any] {
    var metadata: [String: Any] = [
        "helperMethod": method,
    ]

    for (key, value) in extraMetadata {
        metadata[key] = value
    }

    return [
        "actionId": actionId,
        "ok": true,
        "status": "passed",
        "adapter": "mac-helper",
        "metadata": metadata,
    ]
}

private func nonEmptyString(_ value: Any?) -> String? {
    guard let string = value as? String else {
        return nil
    }

    let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
}

private func hasElement(_ action: [String: Any]) -> Bool {
    guard let element = action["element"] as? [String: Any] else {
        return false
    }

    return nonEmptyString(element["id"]) != nil
}

private func hasPointInput(_ action: [String: Any]) -> Bool {
    guard let input = action["input"] as? [String: Any] else {
        return false
    }

    return isNumber(input["x"]) && isNumber(input["y"])
}

private func hasDragDestination(_ action: [String: Any]) -> Bool {
    guard let input = action["input"] as? [String: Any] else {
        return false
    }

    return (isNumber(input["toX"]) && isNumber(input["toY"]))
        || (isNumber(input["deltaX"]) && isNumber(input["deltaY"]))
}

private func actionPoint(_ action: [String: Any]) -> CGPoint? {
    return actionPoint(action, xKey: "x", yKey: "y")
}

private func actionPoint(_ action: [String: Any], xKey: String, yKey: String) -> CGPoint? {
    guard let input = action["input"] as? [String: Any],
          let x = input[xKey] as? NSNumber,
          let y = input[yKey] as? NSNumber
    else {
        return nil
    }

    return CGPoint(x: x.doubleValue, y: y.doubleValue)
}

private func actionElementCenter(_ action: [String: Any], expectedPid: pid_t) -> CGPoint? {
    guard let element = resolveActionElement(action, expectedPid: expectedPid) else {
        return nil
    }

    return axElementCenter(element)
}

private func dragEndPoint(_ action: [String: Any], start: CGPoint) -> CGPoint? {
    if let point = actionPoint(action, xKey: "toX", yKey: "toY") {
        return point
    }

    guard let input = action["input"] as? [String: Any],
          let deltaX = input["deltaX"] as? NSNumber,
          let deltaY = input["deltaY"] as? NSNumber
    else {
        return nil
    }

    return CGPoint(x: start.x + deltaX.doubleValue, y: start.y + deltaY.doubleValue)
}

private func isPositiveNumber(_ value: Any) -> Bool {
    guard let number = value as? NSNumber else {
        return false
    }

    return number.doubleValue > 0
}

private func numberDouble(_ value: Any?) -> Double? {
    guard let number = value as? NSNumber else {
        return nil
    }

    return number.doubleValue
}

private func isNumber(_ value: Any?) -> Bool {
    return value is NSNumber
}

private func response(id: Any?, result: [String: Any]) -> [String: Any] {
    return [
        "jsonrpc": "2.0",
        "id": id ?? NSNull(),
        "result": result,
    ]
}

private func response(id: Any?, error: [String: Any]) -> [String: Any] {
    return [
        "jsonrpc": "2.0",
        "id": id ?? NSNull(),
        "error": error,
    ]
}

private func rpcError(code: String, message: String) -> [String: Any] {
    return [
        "code": code,
        "message": message,
    ]
}

private func timestamp() -> String {
    ISO8601DateFormatter().string(from: Date())
}

private func writeJsonLine(_ value: [String: Any]) {
    do {
        let data = try JSONSerialization.data(withJSONObject: value, options: [])
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0A]))
    } catch {
        let line = "{\"jsonrpc\":\"2.0\",\"id\":null,\"error\":{\"code\":\"ENCODE_ERROR\",\"message\":\"\(error.localizedDescription)\"}}\n"
        if let data = line.data(using: .utf8) {
            FileHandle.standardOutput.write(data)
        }
    }
}

// MARK: - Screenshot

private func handleScreenshot(id: Any?, params: [String: Any]) -> [String: Any] {
    guard let targetDict = params["target"] as? [String: Any],
          let bundleId = targetDict["id"] as? String else {
        return response(id: id, error: rpcError(code: "INVALID_REQUEST", message: "target.id is required"))
    }
    
    guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).first else {
        return response(id: id, error: rpcError(code: "TARGET_NOT_FOUND", message: "App not running: \(bundleId)"))
    }
    
    // Get all windows for the app
    let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    
    let appWindows = windows.filter { window in
        if let owner = window[kCGWindowOwnerPID as String] as? Int32 {
            return owner == app.processIdentifier
        }
        return false
    }
    
    guard let mainWindow = appWindows.first,
          let windowNumber = mainWindow[kCGWindowNumber as String] as? CGWindowID else {
        return response(id: id, error: rpcError(code: "NO_WINDOW", message: "No window found for app"))
    }
    
    // Capture window screenshot
    guard let cgImage = CGWindowListCreateImage(
        .null,
        .optionIncludingWindow,
        windowNumber,
        [.boundsIgnoreFraming, .bestResolution]
    ) else {
        return response(id: id, error: rpcError(code: "SCREENSHOT_FAILED", message: "Failed to capture window"))
    }
    
    // Convert to PNG data
    let bitmapRep = NSBitmapImageRep(cgImage: cgImage)
    guard let pngData = bitmapRep.representation(using: .png, properties: [:]) else {
        return response(id: id, error: rpcError(code: "ENCODE_FAILED", message: "Failed to encode PNG"))
    }
    
    // Convert to base64
    let base64String = pngData.base64EncodedString()
    
    return response(id: id, result: [
        "format": "png",
        "data": base64String,
        "width": cgImage.width,
        "height": cgImage.height
    ])
}
