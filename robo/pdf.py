"""Comprovante PDF de cada aprovação."""
import io, os, re
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

_F = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fontes') + os.sep
pdfmetrics.registerFont(TTFont('DV', _F + 'DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('DVB', _F + 'DejaVuSans-Bold.ttf'))

PASTAS = {"148 · Sertão": "148 - Sertão", "153 · Caturité": "153 - Caturité", "157 · Nova Olinda": "157 - Nova Olinda",
          "162 · Borborema II": "162 - Borborema II", "Anita Cabral": "Anita Cabral", "CCM": "CCM"}

def br(iso):
    if not iso: return "—"
    d, t = iso.split("T")
    y, m, dd = d.split("-")
    return f"{dd}/{m}/{y} {t}"

def safe(s):
    s = s.replace("/", "-").replace("\\", "-").replace(":", "")
    s = re.sub(r'[<>"|?*]', "", s)
    return s.strip()[:150]

H = ParagraphStyle('h', fontName='DVB', fontSize=14, leading=18, spaceAfter=4)
S = ParagraphStyle('s', fontName='DV', fontSize=9, leading=12, textColor=colors.HexColor('#555555'))
N = ParagraphStyle('n', fontName='DV', fontSize=10, leading=14)
B = ParagraphStyle('b', fontName='DVB', fontSize=11, leading=15, spaceBefore=8, spaceAfter=4)

def gera(p, texto, pasta):
    nome = f"{p['aprovadoEm'][:10]} - {safe(p['assunto'])}.pdf"
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=18*mm, rightMargin=18*mm, topMargin=16*mm, bottomMargin=16*mm,
                            title=p['assunto'], author="Fluxo de E-mails — CMRP")
    el = [Paragraph("Comprovante de aprovação", S), Paragraph(p['assunto'], H)]
    info = [["Obra", pasta], ["Tipo", p['tipo']], ["Solicitante", p['por']], ["Envio", br(p['envio'])]]
    if p.get('valor'): info.append(["Valor", p['valor']])
    info.append(["Aprovado em", br(p['aprovadoEm'])])
    t = Table([[Paragraph(f"<b>{a}</b>", N), Paragraph(b, N)] for a, b in info], colWidths=[35*mm, 139*mm])
    t.setStyle(TableStyle([('GRID', (0,0), (-1,-1), 0.4, colors.HexColor('#CCCCCC')),
                           ('BACKGROUND', (0,0), (0,-1), colors.HexColor('#F2F2F2')),
                           ('VALIGN', (0,0), (-1,-1), 'MIDDLE')]))
    el += [Spacer(1, 4), t, Paragraph("Linha do tempo", B)]
    rows = [[Paragraph("<b>Etapa</b>", N), Paragraph("<b>Situação</b>", N), Paragraph("<b>Data e hora</b>", N)],
            [Paragraph("Envio", N), Paragraph(p['por'], N), Paragraph(br(p['envio']), N)]]
    lab = {"ok": "Aprovado", "pendente": "Pendente", "folga": "Folga", "ausente": "Ausente", "devolvido": "Devolvido"}
    for e in p['etapas']:
        rows.append([Paragraph(e['quem'], N), Paragraph(lab.get(e['status'], e['status']), N), Paragraph(br(e.get('em')), N)])
    t2 = Table(rows, colWidths=[45*mm, 60*mm, 69*mm])
    t2.setStyle(TableStyle([('GRID', (0,0), (-1,-1), 0.4, colors.HexColor('#CCCCCC')),
                            ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#E8F1E8'))]))
    el += [t2, Paragraph("Texto da aprovação", B), Paragraph(texto, N)]
    if p.get('obs'):
        el.append(Paragraph("Observações", B))
        for o in p['obs']:
            el.append(Paragraph("• " + o.replace("<", "&lt;").replace(">", "&gt;"), N))
    el += [Spacer(1, 10), Paragraph("Gerado automaticamente pelo robô do Fluxo CMRP a partir dos e-mails (LocaWeb). A autorização oficial é o e-mail original.", S)]
    doc.build(el)
    return nome, buf.getvalue()

