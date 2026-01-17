/**
 * Migration script to create LeadMagnet records for existing quizzes
 * and establish the bidirectional relationship.
 * 
 * Run with: node scripts/migrateQuizzesToLeadMagnets.mjs
 */

import mongoose from 'mongoose';
import 'dotenv/config';

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('Error: MONGODB_URI environment variable is not set');
  process.exit(1);
}

// Define schemas inline for the migration
const quizSchema = new mongoose.Schema({}, { strict: false });
const Quiz = mongoose.model('Quiz', quizSchema, 'quizzes');

const leadMagnetSchema = new mongoose.Schema({}, { strict: false });
const LeadMagnet = mongoose.model('LeadMagnet', leadMagnetSchema, 'leadmagnets');

const brandSchema = new mongoose.Schema({}, { strict: false });
const Brand = mongoose.model('Brand', brandSchema, 'brands');

async function migrateQuizzesToLeadMagnets() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Find all quizzes that don't have a leadMagnetId
    const quizzesWithoutLeadMagnet = await Quiz.find({ 
      leadMagnetId: { $exists: false } 
    }).lean();

    console.log(`Found ${quizzesWithoutLeadMagnet.length} quizzes without leadMagnetId`);

    if (quizzesWithoutLeadMagnet.length === 0) {
      console.log('No quizzes to migrate. Exiting.');
      await mongoose.disconnect();
      return;
    }

    let successCount = 0;
    let errorCount = 0;

    for (const quiz of quizzesWithoutLeadMagnet) {
      try {
        // Get brand info if available
        let brand = null;
        if (quiz.brandId) {
          brand = await Brand.findById(quiz.brandId).lean();
        }

        // Check if a LeadMagnet with this slug already exists for this user
        const existingLeadMagnet = await LeadMagnet.findOne({
          userId: quiz.userId,
          slug: quiz.slug,
        }).lean();

        if (existingLeadMagnet) {
          console.log(`LeadMagnet already exists for quiz: ${quiz.title} (${quiz.slug})`);
          
          // Just link them
          await Quiz.updateOne(
            { _id: quiz._id },
            { $set: { leadMagnetId: existingLeadMagnet._id } }
          );

          await LeadMagnet.updateOne(
            { _id: existingLeadMagnet._id },
            { $set: { quizId: quiz._id } }
          );

          successCount++;
          console.log(`✓ Linked existing LeadMagnet to quiz: ${quiz.title}`);
          continue;
        }

        // Create new LeadMagnet record
        const leadMagnet = await LeadMagnet.create({
          userId: quiz.userId,
          brandId: quiz.brandId || undefined,
          quizId: quiz._id,
          sourceType: brand?.sourceType || 'website',
          sourceUrl: brand?.sourceUrl || '',
          goal: 'get_leads',
          type: 'quiz',
          tone: 'professional',
          title: quiz.title,
          slug: quiz.slug,
          isPublished: quiz.status === 'published',
          isPublic: quiz.isPublic || false,
          generationStatus: 'complete',
          landingStatus: 'ready',
          emailsStatus: 'ready',
          createdAt: quiz.createdAt,
          updatedAt: quiz.updatedAt,
        });

        // Update quiz with leadMagnetId
        await Quiz.updateOne(
          { _id: quiz._id },
          { $set: { leadMagnetId: leadMagnet._id } }
        );

        successCount++;
        console.log(`✓ Created LeadMagnet and linked to quiz: ${quiz.title}`);
      } catch (error) {
        errorCount++;
        console.error(`✗ Error processing quiz: ${quiz.title}`, error.message);
      }
    }

    console.log('\n=== Migration Complete ===');
    console.log(`Successfully migrated: ${successCount} quizzes`);
    console.log(`Errors: ${errorCount}`);

    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  } catch (error) {
    console.error('Migration failed:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

migrateQuizzesToLeadMagnets();
