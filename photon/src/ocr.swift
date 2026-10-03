// Free, on-device text recognition (Apple Vision). Usage: ocr <image-or-pdf>
// Prints the recognized text one visual row per line, with columns on the same row joined by a tab,
// so "Software Engineer Intern <tab> May 2025 – Aug 2025" stays together.
import Foundation
import Vision
import PDFKit
import AppKit

func cgImages(_ path: String) -> [CGImage] {
  let url = URL(fileURLWithPath: path)
  if url.pathExtension.lowercased() == "pdf", let pdf = PDFDocument(url: url) {
    return (0..<min(pdf.pageCount, 3)).compactMap { i in
      guard let page = pdf.page(at: i) else { return nil }
      let img = page.thumbnail(of: CGSize(width: 2200, height: 2850), for: .mediaBox)
      return img.cgImage(forProposedRect: nil, context: nil, hints: nil)
    }
  }
  guard let img = NSImage(contentsOf: url),
        let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return [] }
  return [cg]
}

struct Piece { let text: String; let box: CGRect }

var out: [String] = []
for image in cgImages(CommandLine.arguments[1]) {
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = true
  try? VNImageRequestHandler(cgImage: image).perform([request])
  let pieces = (request.results ?? []).compactMap { obs -> Piece? in
    guard let t = obs.topCandidates(1).first?.string else { return nil }
    return Piece(text: t, box: obs.boundingBox) // normalized, origin bottom-left
  }
  // Two-column layouts (LinkedIn "Save to PDF" has a sidebar): if some x in 20–45% of the width has no
  // text crossing it and both sides have plenty of text, read the main (wider) column first, then the sidebar.
  var columns: [[Piece]] = [pieces]
  for step in 20...45 {
    let x = CGFloat(step) / 100
    if pieces.contains(where: { $0.box.minX < x && $0.box.maxX > x }) { continue }
    let left = pieces.filter { $0.box.maxX <= x }, right = pieces.filter { $0.box.minX >= x }
    if left.count >= 6 && right.count >= 6 { columns = [right, left]; break }
  }
  for column in columns {
    // Top to bottom, then group pieces whose vertical centers are within half a line of each other.
    var rows: [[Piece]] = []
    for p in column.sorted(by: { $0.box.midY > $1.box.midY }) {
      if let last = rows.last?.first, abs(last.box.midY - p.box.midY) < min(last.box.height, p.box.height) * 0.5 {
        rows[rows.count - 1].append(p)
      } else {
        rows.append([p])
      }
    }
    for row in rows {
      out.append(row.sorted(by: { $0.box.minX < $1.box.minX }).map(\.text).joined(separator: "\t"))
    }
  }
}
print(out.joined(separator: "\n"))
