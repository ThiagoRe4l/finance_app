"""PDF sintético para os testes de importação de fatura.

Nenhuma fatura real entra no repositório (dado sensível, `docs/importacao-fatura.md`
→ D-Import-2): o PDF é montado à mão, com uma linha de texto por item, fonte
Helvetica em WinAnsi — o suficiente para o `pypdf` extrair o texto com acentos.
"""

import io


def make_pdf(lines: list[str]) -> bytes:
    def escape(text: str) -> str:
        return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    content = ["BT", "/F1 10 Tf", "14 TL", "40 800 Td"]
    for line in lines:
        content.append(f"({escape(line)}) Tj T*")
    content.append("ET")
    stream = "\n".join(content).encode("cp1252")

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        b"/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    ]

    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, 1):
        offsets.append(out.tell())
        out.write(f"{number} 0 obj\n".encode() + body + b"\nendobj\n")
    xref = out.tell()
    out.write(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for offset in offsets:
        out.write(f"{offset:010d} 00000 n \n".encode())
    out.write(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref}\n%%EOF\n".encode()
    )
    return out.getvalue()
