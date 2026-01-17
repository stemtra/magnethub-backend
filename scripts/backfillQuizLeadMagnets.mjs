#!/usr/bin/env node
/**
 * Backfill script to create LeadMagnet records for existing Quizzes
 * 
 * This script creates LeadMagnet records for quizzes that don't have one,
 * and links them bidirectionally (quiz.leadMagnetId <-> leadMagnet.quizId)
 * 
 * Run with: node scripts/backfillQuizLeadMagnets.mjs
 */

import mongoose from 'mongoose';
import 'dotenv/config';

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGO_URI environment variable is not set');
  process.exit(1);
}

async function backfillQuizLeadMagnets() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const Quiz = mongoose.connection.collection('quizzes');
    const LeadMagnet = mongoose.connection.collection('leadmagnets');
    const Brand = mongoose.connection.collection('brands');

    // Find all quizzes without leadMagnetId
    const quizzesNeedingLeadMagnet = await Quiz.find({
      leadMagnetId: { $exists: false }
    }).toArray();

    console.log(`📊 Found ${quizzesNeedingLeadMagnet.length} quizzes that need LeadMagnet records\n`);

    if (quizzesNeedingLeadMagnet.length === 0) {
      console.log('✨ No quizzes need updating!');
      return;
    }

    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const quiz of quizzesNeedingLeadMagnet) {
      try {
        console.log(`\n📝 Processing: ${quiz.title}`);
        console.log(`   Quiz ID: ${quiz._id}`);
        console.log(`   User ID: ${quiz.userId}`);

        // Get brand info if brandId exists
        let brand = null;
        if (quiz.brandId) {
          brand = await Brand.findOne({ _id: quiz.brandId });
          if (brand) {
            console.log(`   Brand: ${brand.title}`);
          }
        }

        // Create LeadMagnet record
        const leadMagnetData = {
          userId: quiz.userId,
          brandId: quiz.brandId || null,
          sourceType: brand?.sourceType || 'website',
          sourceUrl: brand?.sourceUrl || '',
          goal: 'get_leads',
          type: 'quiz',
          tone: 'professional',
          title: quiz.title,
          slug: quiz.slug,
          isPublished: quiz.status === 'published',
          isPublic: quiz.isPublic !== undefined ? quiz.isPublic : false,
          generationStatus: 'complete',
          landingStatus: 'ready',
          emailsStatus: 'ready',
          createdAt: quiz.createdAt || new Date(),
          updatedAt: new Date(),
        };

        const insertResult = await LeadMagnet.insertOne(leadMagnetData);
        const leadMagnetId = insertResult.insertedId;

        console.log(`   ✅ Created LeadMagnet: ${leadMagnetId}`);

        // Update Quiz with leadMagnetId
        await Quiz.updateOne(
          { _id: quiz._id },
          { 
            $set: { 
              leadMagnetId: leadMagnetId,
              updatedAt: new Date()
            } 
          }
        );

        console.log(`   ✅ Updated Quiz with leadMagnetId`);

        // Update LeadMagnet with quizId (bidirectional link)
        await LeadMagnet.updateOne(
          { _id: leadMagnetId },
          { 
            $set: { 
              quizId: quiz._id,
              updatedAt: new Date()
            } 
          }
        );

        console.log(`   ✅ Linked LeadMagnet back to Quiz`);

        created++;

      } catch (error) {
        console.error(`   ❌ Error processing quiz ${quiz._id}:`, error.message);
        errors++;
      }
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log('✅ Backfill complete!');
    console.log(`   - Created: ${created} LeadMagnet records`);
    console.log(`   - Skipped: ${skipped} quizzes`);
    console.log(`   - Errors: ${errors} quizzes`);
    console.log('='.repeat(60));

  } catch (error) {
    console.error('❌ Backfill failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

backfillQuizLeadMagnets();
