import Foundation
import Vision
import PDFKit
import ImageIO
import AppKit

struct OCRFailure: Error { let message: String }
func fail(_ message: String) throws -> Never { throw OCRFailure(message: message) }
func recognize(_ image: CGImage, orientation: CGImagePropertyOrientation = .up) throws -> String {
    let request = VNRecognizeTextRequest()
    request.revision = VNRecognizeTextRequestRevision3
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    let supported = try request.supportedRecognitionLanguages()
    request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"].filter { supported.contains($0) }
    try VNImageRequestHandler(cgImage: image, orientation: orientation).perform([request])
    return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
}
func extract(_ data: Data, _ format: String) throws -> [String: Any] {
    var parts: [String] = []
    var ocrPages: [Int] = []
    var emptyPages: [Int] = []
    var pages = 1
    if format == ".pdf" {
        guard let document = PDFDocument(data: data) else { try fail("文件不是有效 PDF") }
        if document.isLocked { try fail("PDF 已加密，请先解密") }
        pages = document.pageCount
        if pages < 1 || pages > 30 { try fail("OCR 支持最多 30 页 PDF，请拆分材料") }
        for index in 0..<pages {
            let content: String = try autoreleasepool {
                guard let page = document.page(at: index) else { try fail("无法读取 PDF 页面") }
                let bounds = page.bounds(for: .mediaBox)
                guard bounds.width.isFinite, bounds.height.isFinite, bounds.width > 0, bounds.height > 0 else { try fail("PDF 页面尺寸无效") }
                let scale = 2400 / max(bounds.width, bounds.height)
                let image = page.thumbnail(of: CGSize(width: bounds.width * scale, height: bounds.height * scale), for: .mediaBox)
                var rect = CGRect(origin: .zero, size: image.size)
                guard let cg = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else { try fail("无法读取 PDF 页面图像") }
                let recognized = try recognize(cg)
                let embedded = (page.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                // Rendering all pages also captures images in otherwise text-bearing PDFs.
                // If recognition finds nothing, retain the PDF's embedded text.
                if !recognized.isEmpty { ocrPages.append(index + 1); return recognized }
                return embedded
            }
            if content.isEmpty { emptyPages.append(index + 1) }
            parts.append("## 第 \(index + 1) 页\n\(content)")
            if parts.joined().utf8.count > 524288 { try fail("提取文字超过 512 KB，请拆分文件") }
        }
    } else {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int,
              width > 0, height > 0, Double(width) * Double(height) <= 50000000 else { try fail("图片无效或超过 5000 万像素，请缩小图片") }
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: 3000] as CFDictionary) else { try fail("无法读取图片") }
        let content = try recognize(image)
        if !content.isEmpty { ocrPages = [1] }
        parts = [content]
    }
    if ocrPages.isEmpty && parts.allSatisfy({ $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) { try fail("没有识别到可用文字，请上传更清晰的图片") }
    if format == ".pdf" && emptyPages.count == pages { try fail("PDF 未识别到可用文字，请上传更清晰的扫描件") }
    let content = parts.joined(separator: "\n\n")
    if content.utf8.count > 524288 { try fail("提取文字超过 512 KB，请拆分文件") }
    var warnings = ["本机 Apple Vision OCR（中英文）；文字、数字及表格可能识别有误，请核对预览后确认。", "按页面读取文字，不恢复复杂表格和原版式；OCR 数据不能直接视为准确统计数据。"]
    if !emptyPages.isEmpty { warnings.append("以下页面未识别到文字：\(emptyPages.map(String.init).joined(separator: "、"))") }
    return ["content": content, "tables": [], "pages": pages, "ocrPages": ocrPages, "method": "apple-vision-ocr", "warnings": warnings]
}
do {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    if data.isEmpty || data.count > 20971520 { try fail("文件需非空且不超过 20 MB") }
    let result = try extract(data, CommandLine.arguments.dropFirst().first ?? "")
    FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: ["result": result]))
} catch {
    let message = (error as? OCRFailure)?.message ?? "本机 OCR 未能完成，请检查文件或拆分材料"
    FileHandle.standardOutput.write((try? JSONSerialization.data(withJSONObject: ["error": message])) ?? Data())
    exit(1)
}
