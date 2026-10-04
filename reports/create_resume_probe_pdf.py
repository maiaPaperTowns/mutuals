from pathlib import Path
from reportlab.pdfgen.canvas import Canvas
from reportlab.lib.pagesizes import letter
from pypdf import PdfReader

root = Path(__file__).resolve().parents[1]
folder = root / 'tmp/pdfs'
folder.mkdir(parents=True, exist_ok=True)
path = folder / 'resume-upload-smoke-test.pdf'
canvas = Canvas(str(path), pagesize=letter)
canvas.setFont('Helvetica-Bold', 18)
canvas.drawString(56, 730, 'SYNTHETIC RESUME UPLOAD TEST')
canvas.setFont('Helvetica', 12)
for y, text in zip(range(690, 529, -24), [
    'This is a synthetic parser fixture, not the account owner\'s resume.',
    'Test candidate role: software developer.',
    'Skills: Rust, GraphQL.',
    'Project: event networking application.',
    'Goal: meet engineers working on developer tools.',
    'Test data must be removed from the account after verification.',
]):
    canvas.drawString(56, y, text)
canvas.save()
text = PdfReader(path).pages[0].extract_text()
assert 'Rust' in text and 'GraphQL' in text
print('Generated one readable text-based PDF fixture.')
