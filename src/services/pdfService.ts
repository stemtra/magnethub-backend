import PDFDocument from 'pdfkit';
import { logger } from '../utils/logger.js';
import { AppError } from '../utils/AppError.js';
import type { ILeadMagnetContent, LeadMagnetType } from '../types/index.js';

// ============================================
// Design Constants
// ============================================

const colors = {
  primary: '#8B7355',        // Warm brown accent
  primaryLight: '#B8956D',   // Lighter brown
  dark: '#1a1a1a',           // Near black for headings
  text: '#2C2C2C',           // Dark gray for body
  muted: '#666666',          // Medium gray for secondary
  light: '#999999',          // Light gray for hints
  background: '#FAF8F5',     // Warm off-white
  cardBg: '#FFFFFF',         // White for cards
  border: '#E8E4DF',         // Subtle border
};

const fonts = {
  regular: 'Helvetica',
  bold: 'Helvetica-Bold',
  italic: 'Helvetica-Oblique',
  boldItalic: 'Helvetica-BoldOblique',
};

// ============================================
// Helper Functions
// ============================================

function drawHorizontalLine(doc: PDFKit.PDFDocument, y: number, margin: number = 70) {
  doc.moveTo(margin, y)
     .lineTo(doc.page.width - margin, y)
     .strokeColor(colors.border)
     .lineWidth(1)
     .stroke();
}

function drawCenteredText(
  doc: PDFKit.PDFDocument, 
  text: string, 
  y: number, 
  options: { fontSize?: number; font?: string; color?: string } = {}
) {
  const { fontSize = 12, font = fonts.regular, color = colors.text } = options;
  doc.fontSize(fontSize)
     .font(font)
     .fillColor(color)
     .text(text, 0, y, { align: 'center', width: doc.page.width });
}

function addPageNumber(doc: PDFKit.PDFDocument, pageNum: number) {
  doc.fontSize(9)
     .font(fonts.regular)
     .fillColor(colors.light)
     .text(
       `${pageNum}`,
       0,
       doc.page.height - 50,
       { align: 'center', width: doc.page.width }
     );
}

function parseMarkdownLine(text: string): { type: 'bullet' | 'numbered' | 'text'; content: string; number?: number } {
  // Check for bullet point
  const bulletMatch = text.match(/^[-*•]\s+(.+)$/);
  if (bulletMatch) {
    return { type: 'bullet', content: bulletMatch[1] };
  }
  
  // Check for numbered list
  const numberedMatch = text.match(/^(\d+)[.)]\s+(.+)$/);
  if (numberedMatch) {
    return { type: 'numbered', content: numberedMatch[2], number: parseInt(numberedMatch[1]) };
  }
  
  return { type: 'text', content: text };
}

function stripMarkdownFormatting(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')  // Bold
    .replace(/\*(.+?)\*/g, '$1')       // Italic
    .replace(/`(.+?)`/g, '$1')         // Code
    .replace(/^#+\s+/gm, '');          // Headers
}

// ============================================
// PDF Generation
// ============================================

export async function generatePdf(
  content: ILeadMagnetContent,
  type: LeadMagnetType
): Promise<Buffer> {
  logger.info('Generating PDF with PDFKit', { title: content.title, type });

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 70, bottom: 70, left: 70, right: 70 },
        bufferPages: true,
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(chunks);
        logger.info('PDF generated successfully', { 
          title: content.title,
          sizeKB: Math.round(pdfBuffer.length / 1024)
        });
        resolve(pdfBuffer);
      });
      doc.on('error', reject);

      let pageNumber = 1;

      // ============================================
      // COVER PAGE
      // ============================================

      // Top badge
      const badgeText = `FREE ${type.toUpperCase()}`;
      doc.fontSize(10)
         .font(fonts.bold)
         .fillColor(colors.primary);
      
      const badgeWidth = doc.widthOfString(badgeText) + 30;
      const badgeX = (doc.page.width - badgeWidth) / 2;
      const badgeY = 180;
      
      // Badge background
      doc.roundedRect(badgeX, badgeY, badgeWidth, 28, 14)
         .fillColor(colors.background)
         .strokeColor(colors.primary)
         .lineWidth(1.5)
         .fillAndStroke();
      
      // Badge text
      doc.fontSize(10)
         .font(fonts.bold)
         .fillColor(colors.primary)
         .text(badgeText, badgeX, badgeY + 8, { width: badgeWidth, align: 'center' });

      // Main title
      doc.fontSize(36)
         .font(fonts.bold)
         .fillColor(colors.dark)
         .text(content.title, 70, 260, { 
           align: 'center', 
           width: doc.page.width - 140,
           lineGap: 8
         });

      // Subtitle
      const subtitleY = doc.y + 30;
      doc.fontSize(14)
         .font(fonts.regular)
         .fillColor(colors.muted)
         .text(content.subtitle, 70, subtitleY, { 
           align: 'center', 
           width: doc.page.width - 140,
           lineGap: 4
         });

      // Decorative line
      const lineY = doc.y + 50;
      doc.moveTo((doc.page.width - 80) / 2, lineY)
         .lineTo((doc.page.width + 80) / 2, lineY)
         .strokeColor(colors.primary)
         .lineWidth(3)
         .stroke();

      // Footer text on cover
      doc.fontSize(10)
         .font(fonts.italic)
         .fillColor(colors.light)
         .text('Your guide to success', 0, doc.page.height - 100, { 
           align: 'center', 
           width: doc.page.width 
         });

      // ============================================
      // CONTENT PAGES
      // ============================================

      for (let i = 0; i < content.sections.length; i++) {
        const section = content.sections[i];
        doc.addPage();
        pageNumber++;

        // Section number badge
        const sectionNum = String(i + 1);
        const circleX = 70;
        const circleY = 70;
        const circleRadius = 18;
        
        doc.circle(circleX + circleRadius, circleY + circleRadius, circleRadius)
           .fillColor(colors.primary)
           .fill();
        
        doc.fontSize(16)
           .font(fonts.bold)
           .fillColor('#FFFFFF')
           .text(sectionNum, circleX, circleY + 8, { width: circleRadius * 2, align: 'center' });

        // Section title
        doc.fontSize(22)
           .font(fonts.bold)
           .fillColor(colors.dark)
           .text(section.title, circleX + circleRadius * 2 + 15, circleY + 8, {
             width: doc.page.width - 140 - circleRadius * 2 - 15
           });

        // Divider line
        const dividerY = Math.max(doc.y + 20, circleY + circleRadius * 2 + 20);
        drawHorizontalLine(doc, dividerY);

        // Section content
        doc.y = dividerY + 25;
        const contentLines = section.content.split('\n').filter(line => line.trim());

        for (const line of contentLines) {
          // Check if we need a new page
          if (doc.y > doc.page.height - 120) {
            addPageNumber(doc, pageNumber);
            doc.addPage();
            pageNumber++;
            doc.y = 70;
          }

          const parsed = parseMarkdownLine(line.trim());
          const cleanContent = stripMarkdownFormatting(parsed.content);

          if (parsed.type === 'bullet' && type === 'checklist') {
            // Checklist item with checkbox
            const checkboxX = 70;
            const checkboxY = doc.y + 2;
            const checkboxSize = 14;

            // Checkbox outline
            doc.rect(checkboxX, checkboxY, checkboxSize, checkboxSize)
               .strokeColor(colors.primary)
               .lineWidth(1.5)
               .stroke();

            // Item text
            doc.fontSize(11)
               .font(fonts.regular)
               .fillColor(colors.text)
               .text(cleanContent, checkboxX + checkboxSize + 12, doc.y, {
                 width: doc.page.width - 140 - checkboxSize - 12,
                 lineGap: 3
               });

            doc.y += 8;
          } else if (parsed.type === 'bullet') {
            // Regular bullet point
            const bulletX = 70;
            doc.circle(bulletX + 3, doc.y + 6, 3)
               .fillColor(colors.primary)
               .fill();

            doc.fontSize(11)
               .font(fonts.regular)
               .fillColor(colors.text)
               .text(cleanContent, bulletX + 16, doc.y, {
                 width: doc.page.width - 140 - 16,
                 lineGap: 3
               });

            doc.y += 6;
          } else if (parsed.type === 'numbered') {
            // Numbered item
            const numX = 70;
            doc.fontSize(11)
               .font(fonts.bold)
               .fillColor(colors.primary)
               .text(`${parsed.number}.`, numX, doc.y, { continued: false });

            doc.fontSize(11)
               .font(fonts.regular)
               .fillColor(colors.text)
               .text(cleanContent, numX + 20, doc.y - 13, {
                 width: doc.page.width - 140 - 20,
                 lineGap: 3
               });

            doc.y += 6;
          } else {
            // Regular paragraph
            // Check if it looks like a subheading (short and possibly bold in markdown)
            const isSubheading = line.startsWith('##') || (cleanContent.length < 60 && line.includes('**'));
            
            if (isSubheading) {
              doc.y += 10;
              doc.fontSize(13)
                 .font(fonts.bold)
                 .fillColor(colors.dark)
                 .text(cleanContent, 70, doc.y, {
                   width: doc.page.width - 140,
                   lineGap: 3
                 });
              doc.y += 8;
            } else if (cleanContent) {
              doc.fontSize(11)
                 .font(fonts.regular)
                 .fillColor(colors.text)
                 .text(cleanContent, 70, doc.y, {
                   width: doc.page.width - 140,
                   lineGap: 4,
                   align: 'justify'
                 });
              doc.y += 10;
            }
          }
        }

        addPageNumber(doc, pageNumber);
      }

      // ============================================
      // CTA PAGE
      // ============================================

      doc.addPage();
      pageNumber++;

      // Centered content
      const ctaStartY = 220;

      // "Ready to Take Action?" heading
      doc.fontSize(28)
         .font(fonts.bold)
         .fillColor(colors.dark)
         .text('Ready to Take Action?', 0, ctaStartY, { 
           align: 'center', 
           width: doc.page.width 
         });

      // Decorative line
      const ctaLineY = doc.y + 30;
      doc.moveTo((doc.page.width - 60) / 2, ctaLineY)
         .lineTo((doc.page.width + 60) / 2, ctaLineY)
         .strokeColor(colors.primary)
         .lineWidth(2)
         .stroke();

      // CTA text
      doc.fontSize(13)
         .font(fonts.regular)
         .fillColor(colors.muted)
         .text(content.cta, 100, ctaLineY + 40, { 
           align: 'center', 
           width: doc.page.width - 200,
           lineGap: 6
         });

      // Bottom decoration
      doc.fontSize(10)
         .font(fonts.italic)
         .fillColor(colors.light)
         .text('Thank you for downloading this guide!', 0, doc.page.height - 120, { 
           align: 'center', 
           width: doc.page.width 
         });

      addPageNumber(doc, pageNumber);

      // Finalize
      doc.end();
    } catch (error) {
      logger.error('PDF generation failed', error);
      reject(AppError.internal('Failed to generate PDF. Please try again.'));
    }
  });
}
