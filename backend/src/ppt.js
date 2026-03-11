import path from 'node:path';
import PptxGenJS from 'pptxgenjs';
import { sanitizeSegment } from './paths.js';

export async function writePresentation({ outline, projectDir }) {
  const pptx = new PptxGenJS();
  const safeTitle = sanitizeSegment(outline.title) || 'presentation';
  const fileName = `${safeTitle}.pptx`;
  const filePath = path.join(projectDir, fileName);

  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'last-version-ppt';
  pptx.company = 'last-version-ppt';
  pptx.subject = outline.subtitle || outline.title;
  pptx.title = outline.title;
  pptx.lang = 'zh-CN';
  pptx.theme = {
    headFontFace: 'Microsoft YaHei',
    bodyFontFace: 'Microsoft YaHei',
    lang: 'zh-CN',
  };

  outline.slides.forEach((slideData, index) => {
    const slide = pptx.addSlide();
    slide.background = { color: index === 0 ? 'F8FAFC' : 'FFFFFF' };
    slide.addText(slideData.title, {
      x: 0.6,
      y: 0.5,
      w: 12,
      h: 0.6,
      fontSize: index === 0 ? 24 : 22,
      bold: true,
      color: '0F172A',
    });

    if (index === 0 && outline.subtitle) {
      slide.addText(outline.subtitle, {
        x: 0.6,
        y: 1.3,
        w: 11.5,
        h: 0.5,
        fontSize: 12,
        color: '475569',
      });
    }

    slide.addShape(pptx.ShapeType.rect, {
      x: 0.6,
      y: index === 0 ? 2 : 1.4,
      w: 0.12,
      h: 4.8,
      line: { color: '2563EB', transparency: 100 },
      fill: { color: '2563EB' },
    });

    const bulletItems = slideData.bullets.length > 0 ? slideData.bullets : ['待补充内容'];
    slide.addText(
      bulletItems.map((text) => ({
        text,
        options: {
          bullet: { indent: 14 },
          breakLine: true,
        },
      })),
      {
        x: 1,
        y: index === 0 ? 2 : 1.6,
        w: 11.2,
        h: 4.6,
        fontSize: 18,
        color: '1E293B',
        paraSpaceAfterPt: 10,
        valign: 'top',
      }
    );

    if (slideData.notes) {
      slide.addNotes(slideData.notes);
    }
  });

  await pptx.writeFile({ fileName: filePath });
  return { fileName, filePath };
}
