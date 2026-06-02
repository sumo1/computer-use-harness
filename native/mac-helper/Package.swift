// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "ComputerUseMacHelper",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "computer-use-mac-helper", targets: ["ComputerUseMacHelper"])
    ],
    targets: [
        .executableTarget(
            name: "ComputerUseMacHelper"
        )
    ]
)
