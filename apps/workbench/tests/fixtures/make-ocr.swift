import AppKit
import PDFKit
import Foundation

let destination = CommandLine.arguments[1]
try FileManager.default.createDirectory(atPath: destination, withIntermediateDirectories: true)
let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1800, pixelsHigh: 800, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
NSColor.white.setFill()
NSRect(x: 0, y: 0, width: 1800, height: 800).fill()
let attributes: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 68), .foregroundColor: NSColor.black]
("宠物陪伴 用户访谈" as NSString).draw(at: NSPoint(x: 100, y: 550), withAttributes: attributes)
("Desktop companion research" as NSString).draw(at: NSPoint(x: 100, y: 400), withAttributes: attributes)
("Users 1000 Conversions 140" as NSString).draw(at: NSPoint(x: 100, y: 250), withAttributes: attributes)
NSGraphicsContext.restoreGraphicsState()
let png = bitmap.representation(using: .png, properties: [:])!
try png.write(to: URL(fileURLWithPath: destination + "/ocr-sample.png"))
try bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.95])!.write(to: URL(fileURLWithPath: destination + "/ocr-sample.jpg"))
let document = PDFDocument()
document.insert(PDFPage(image: NSImage(data: png)!)!, at: 0)
document.write(to: URL(fileURLWithPath: destination + "/ocr-sample.pdf"))
let long = PDFDocument()
for i in 0..<31 { long.insert(PDFPage(image: NSImage(data: png)!)!, at: i) }
long.write(to: URL(fileURLWithPath: destination + "/ocr-too-long.pdf"))
