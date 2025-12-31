import { GoogleGenAI } from '@google/genai';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../utils/AppError.js';
import { uploadImage } from './storageService.js';
import type { IBrand, InfographicStyle, InfographicOrientation } from '../types/index.js';

// Initialize Gemini AI
const ai = new GoogleGenAI({ apiKey: config.geminiApiKey || '' });

// ============================================
// Types
// ============================================

export interface InfographicGenerationOptions {
  topic: string;
  brand: IBrand;
  style: InfographicStyle;
  orientation: InfographicOrientation;
}

export interface GeneratedInfographic {
  imageUrl: string;
  title: string;
  description: string;
}

// ============================================
// Helper: Build Brand Context
// ============================================

function buildBrandContext(brand: IBrand): string {
  const context = [];
  
  context.push(`Brand Name: ${brand.name}`);
  
  if (brand.description) {
    context.push(`What We Do: ${brand.description}`);
  }
  
  if (brand.brandVoice) {
    context.push(`Brand Voice: ${brand.brandVoice}`);
  }
  
  if (brand.targetAudience) {
    context.push(`Target Audience: ${brand.targetAudience}`);
  }
  
  if (brand.keyMessages && brand.keyMessages.length > 0) {
    context.push(`Key Messages:\n${brand.keyMessages.map((msg, i) => `  ${i + 1}. ${msg}`).join('\n')}`);
  }
  
  // Add scraped content insights if available
  if (brand.scrapedContent) {
    const scraped = brand.scrapedContent as any;
    if (scraped.about) {
      context.push(`Business Overview: ${scraped.about}`);
    }
    if (scraped.services || scraped.products) {
      context.push(`Offerings: ${scraped.services || scraped.products}`);
    }
    if (scraped.valueProposition) {
      context.push(`Value Proposition: ${scraped.valueProposition}`);
    }
  }
  
  if (brand.sourceType && brand.sourceUrl) {
    context.push(`Platform: ${brand.sourceType} (${brand.sourceUrl})`);
  }
  
  return context.join('\n');
}

// ============================================
// Helper: Build Prompt for Infographic
// ============================================

function buildInfographicPrompt(options: InfographicGenerationOptions): string {
  const { topic, brand, style, orientation } = options;

  // Build brand context
  const brandContext = [];
  brandContext.push(`Brand: ${brand.name}`);
  if (brand.brandVoice) brandContext.push(`Voice: ${brand.brandVoice}`);
  if (brand.targetAudience) brandContext.push(`Audience: ${brand.targetAudience}`);
  if (brand.description) brandContext.push(`About: ${brand.description}`);
  
  const brandInfo = brandContext.join('\n');

  // Style descriptions
  const styleDescriptions: Record<InfographicStyle, string> = {
    minimal: 'Clean, simple design with lots of white space, minimal colors, elegant typography',
    modern: 'Contemporary design with gradients, bold typography, vibrant colors, trendy aesthetics',
    bold: 'High contrast, strong colors, dramatic typography, attention-grabbing design',
    professional: 'Corporate style, muted color palette, structured layout, business-appropriate',
  };

  // Orientation specs
  const orientationSpecs: Record<InfographicOrientation, string> = {
    square: '1:1 aspect ratio (1080x1080px), perfect for Instagram posts',
    portrait: 'Vertical 9:16 aspect ratio (1080x1920px), perfect for Instagram Stories',
    landscape: 'Horizontal 16:9 aspect ratio (1920x1080px), perfect for presentations',
  };

  const prompt = `Create a professional infographic about: "${topic}"

BRAND CONTEXT:
${brandInfo}

DESIGN REQUIREMENTS:
- Style: ${style} - ${styleDescriptions[style]}
- Format: ${orientation} - ${orientationSpecs[orientation]}
- Include brand name/logo representation
- Use brand colors if available (Primary: ${brand.settings.primaryColor}, Accent: ${brand.settings.accentColor})
- Make it visually engaging and shareable
- Include clear, readable text
- Use icons, charts, or illustrations where appropriate
- Ensure high quality and professional finish

CONTENT GUIDELINES:
- Create a catchy, clear title
- Break down information into digestible sections
- Use bullet points, numbers, or visual hierarchy
- Include 3-5 key points or statistics
- Add a subtle call-to-action at the bottom
- Keep text concise and impactful

The infographic should be visually stunning, informative, and aligned with the brand's identity.`;

  return prompt;
}

// ============================================
// Generate Infographic
// ============================================

export async function generateInfographic(
  options: InfographicGenerationOptions
): Promise<GeneratedInfographic> {
  const { topic, brand } = options;

  logger.info('Starting infographic generation', {
    topic,
    brandId: brand._id,
    brandName: brand.name,
    style: options.style,
    orientation: options.orientation,
  });

  try {
    // Build the prompt
    const prompt = buildInfographicPrompt(options);

    // Generate content structure with Gemini - WITH BRAND CONTEXT
    const brandContext = buildBrandContext(brand);
    
    const contentPrompt = `You are creating an infographic for ${brand.name}.

BRAND CONTEXT:
${brandContext}

USER REQUEST: "${topic}"

Your task: Create a structured outline for a BRAND-SPECIFIC infographic that:
1. Addresses the user's topic THROUGH THE LENS of ${brand.name}'s value proposition
2. Provides actionable value to the brand's target audience: ${brand.targetAudience || 'their customers'}
3. Subtly reinforces ${brand.name}'s expertise and solutions
4. Is highly shareable and positions ${brand.name} as a thought leader

Even if the topic is vague (like "something useful"), you MUST interpret it in the context of ${brand.name}'s business and create something valuable for their audience.

Return a JSON object with:
{
  "title": "Compelling headline (max 50 chars, brand-relevant)",
  "subtitle": "Supporting value proposition (max 80 chars)",
  "sections": [
    "Key insight 1 (specific, actionable, branded)",
    "Key insight 2 (with data or benefit)",
    "Key insight 3 (addresses pain point)",
    "Key insight 4 (shows solution/value)"
  ],
  "cta": "Clear call to action mentioning ${brand.name}"
}

Make it punchy, data-driven when possible, and unmistakably about ${brand.name}'s value to their audience.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview',
      contents: contentPrompt,
    });

    const text = response.text;
    
    if (!text) {
      throw new Error('Empty response from Gemini');
    }
    
    // Parse the JSON response
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    const jsonCandidate = firstBrace !== -1 && lastBrace !== -1 
      ? text.slice(firstBrace, lastBrace + 1)
      : text;
    
    const contentData = JSON.parse(jsonCandidate);

    logger.info('Infographic content generated', {
      title: contentData.title,
      sections: contentData.sections?.length,
    });

    // Generate actual image with Gemini
    const imageUrl = await generateInfographicImage(contentData, options);

    logger.info('Infographic generation successful', {
      topic,
      brandId: brand._id,
      imageUrl,
    });

    return {
      imageUrl,
      title: contentData.title || topic,
      description: contentData.subtitle || `An infographic about ${topic}`,
    };
  } catch (error) {
    logger.error('Infographic generation failed', {
      error: error instanceof Error ? error.message : String(error),
      topic,
      brandId: brand._id,
    });

    throw new AppError(
      `Failed to generate infographic: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500,
      'INFOGRAPHIC_GENERATION_FAILED'
    );
  }
}

// ============================================
// Image Generation with Gemini
// ============================================

async function generateInfographicImage(
  contentData: any,
  options: InfographicGenerationOptions
): Promise<string> {
  const { style, orientation, topic, brand } = options;
  
  // Map orientation to aspect ratio
  const aspectRatios = {
    square: '1:1',
    portrait: '9:16',
    landscape: '16:9',
  };
  
  const aspectRatio = aspectRatios[orientation];
  
  // Get brand colors
  const primaryColor = brand.settings?.primaryColor || '#667EEA';
  const accentColor = brand.settings?.accentColor || '#764BA2';
  
  // Build comprehensive brand context
  const brandContext = buildBrandContext(brand);
  
  // Build detailed image prompt for text-to-image generation
  const imagePrompt = `Create a professional ${style} style infographic for ${brand.name} with a ${aspectRatio} aspect ratio.

BRAND CONTEXT:
${brandContext}

INFOGRAPHIC CONTENT:
Title: "${contentData.title}"
Subtitle: "${contentData.subtitle || ''}"

Key Points to Visualize:
${contentData.sections?.map((s: any, i: number) => `${i + 1}. ${typeof s === 'string' ? s : s.title || s.point}`).join('\n') || ''}

${contentData.cta ? `Call to Action: "${contentData.cta}"` : ''}

DESIGN REQUIREMENTS:
- Style: ${style === 'modern' ? 'Clean, contemporary design with gradients and bold typography' : style === 'minimal' ? 'Minimalist, lots of white space, elegant' : style === 'bold' ? 'High contrast, vibrant colors, attention-grabbing' : 'Professional corporate aesthetic, structured layout'}
- Primary Color: ${primaryColor}
- Accent Color: ${accentColor}
- Include brand name "${brand.name}" prominently at top or bottom
- Use icons, charts, or illustrations that relate to ${brand.name}'s industry
- Clear visual hierarchy with the title at the top
- Each key point should have an accompanying icon or visual element
- ${aspectRatio === '9:16' ? 'Vertical layout optimized for Instagram Stories/mobile' : aspectRatio === '16:9' ? 'Horizontal layout optimized for LinkedIn/presentations' : 'Square format optimized for Instagram posts'}
- Professional, polished, marketing-ready quality
- Ensure all text is readable and well-contrasted
- Make it look like it was designed by a professional brand designer

The infographic must clearly communicate ${brand.name}'s expertise and value to their target audience.`;

  try {
    logger.info('Generating infographic image with Gemini', {
      model: 'gemini-3-pro-image-preview',
      style,
      orientation,
      aspectRatio,
      brandName: brand.name,
    });

    // Call Gemini for image generation
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview',
      contents: imagePrompt,
    });

    // Gemini returns images in the 'parts' array with inlineData
    // The response object has candidates[].content.parts[] structure
    logger.info('Checking Gemini response structure', {
      hasCandidates: !!response.candidates,
      candidatesLength: response.candidates?.length,
    });

    if (response.candidates && response.candidates.length > 0) {
      const candidate = response.candidates[0];
      if (candidate.content && candidate.content.parts) {
        // Look for inline image data
        for (const part of candidate.content.parts) {
          if (part.inlineData && part.inlineData.data) {
            // Found the image!
            const mimeType = part.inlineData.mimeType || 'image/png';
            const base64Data = part.inlineData.data;
            
            logger.info('Successfully extracted image from Gemini response', {
              mimeType,
              dataLength: base64Data.length,
            });
            
            // Convert base64 to buffer
            const imageBuffer = Buffer.from(base64Data, 'base64');
            
            // Upload to R2 and return permanent URL
            try {
              const publicUrl = await uploadImage(imageBuffer, mimeType);
              logger.info('Infographic uploaded to R2 successfully', { publicUrl });
              return publicUrl;
            } catch (uploadError) {
              logger.error('Failed to upload infographic to R2, falling back to placeholder', {
                error: uploadError instanceof Error ? uploadError.message : String(uploadError),
              });
              // Fallback to placeholder if R2 upload fails
              return generatePlaceholderImage(contentData, options);
            }
          }
        }
      }
    }

    // If we get here, no image was found in response
    logger.warn('No image data found in Gemini response, using placeholder');
    return generatePlaceholderImage(contentData, options);
  } catch (error) {
    logger.error('Image generation with Gemini failed, using placeholder', {
      error: error instanceof Error ? error.message : String(error),
    });
    
    // Fallback to placeholder
    return generatePlaceholderImage(contentData, options);
  }
}

// ============================================
// Placeholder Image Generation (Fallback)
// ============================================

function generatePlaceholderImage(
  contentData: any,
  options: InfographicGenerationOptions
): string {
  const { orientation, style } = options;
  
  const dimensions = {
    square: { width: 1080, height: 1080 },
    portrait: { width: 1080, height: 1920 },
    landscape: { width: 1920, height: 1080 },
  };
  
  const dim = dimensions[orientation];
  
  // Use DiceBear API or similar for more interesting placeholders
  // Or use Unsplash with relevant keywords
  const topic = encodeURIComponent(contentData.title || 'Infographic');
  
  // Using a combination of services for better placeholders:
  // Option 1: Unsplash (real photos related to topic)
  // Option 2: Placeholder.com with better styling
  // Option 3: Generated gradient backgrounds
  
  // For now, use a styled placeholder that looks professional
  const styleColors = {
    modern: { bg: '667EEA', fg: 'FFFFFF' },
    minimal: { bg: 'F7FAFC', fg: '2D3748' },
    bold: { bg: 'E53E3E', fg: 'FFFFFF' },
    professional: { bg: '2D3748', fg: 'FFFFFF' },
  };
  
  const colors = styleColors[style];
  const placeholderUrl = `https://placehold.co/${dim.width}x${dim.height}/${colors.bg}/${colors.fg}/png?text=${topic}&font=montserrat`;
  
  logger.info('Generated placeholder image URL', {
    url: placeholderUrl,
    style,
    orientation,
  });
  
  return placeholderUrl;
}

// ============================================
// Future: Imagen 3 Integration
// ============================================

/*
async function generateWithImagen3(
  prompt: string,
  options: InfographicGenerationOptions
): Promise<string> {
  // When Imagen 3 API is available:
  
  const imageRequest = {
    prompt: prompt,
    number_of_images: 1,
    aspect_ratio: options.orientation === 'square' ? '1:1' 
                 : options.orientation === 'portrait' ? '9:16' 
                 : '16:9',
    safety_filter_level: 'block_few',
    person_generation: 'dont_allow',
  };
  
  const response = await fetch('IMAGEN_3_API_ENDPOINT', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.geminiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(imageRequest),
  });
  
  const result = await response.json();
  return result.images[0].url;
}
*/

