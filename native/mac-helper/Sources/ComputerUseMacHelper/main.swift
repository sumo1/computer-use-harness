import AppKit
import ApplicationServices
import Foundation

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
    case "click", "type", "key", "scroll":
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
    let ownerName = (target["name"] as? String)?.lowercased()

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
        if let ownerName, !windowOwner.lowercased().contains(ownerName) {
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

    return [
        "target": target,
        "windows": windows,
        "observation": [
            "id": "\(target["id"] as? String ?? "target"):observation:mac-helper",
            "target": target,
            "source": "mac-helper",
            "timestamp": timestamp(),
            "elements": [],
            "metadata": [
                "helperMethod": "getAppState",
                "windowCount": windows.count,
            ],
        ],
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
    case "click":
        if !hasElement(action) && !hasPointInput(action) {
            return failedActionResult(
                actionId: actionId,
                method: method,
                code: "INVALID_REQUEST",
                message: "click requires action.element or numeric action.input.x/y."
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

private func isPositiveNumber(_ value: Any) -> Bool {
    guard let number = value as? NSNumber else {
        return false
    }

    return number.doubleValue > 0
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
