#!/usr/bin/env node
/**
 * Migration script to backfill emailCapturedAt for existing QuizResponse documents
 * 
 * This script updates QuizResponse documents that have an email but don't have
 * emailCapturedAt set, using completedAt or createdAt as the fallback value.
 * 
 * Run with: node scripts/backfillEmailCapturedAt.mjs
 */

import mongoose from 'mongoose';
import 'dotenv/config';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/magnethub';

async function backfillEmailCapturedAt() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const QuizResponse = mongoose.connection.collection('quizresponses');

    // Find responses that have email but no emailCapturedAt
    const responsesNeedingUpdate = await QuizResponse.find({
      email: { $exists: true, $ne: '' },
      emailCapturedAt: { $exists: false }
    }).toArray();

    console.log(`📊 Found ${responsesNeedingUpdate.length} responses that need backfilling\n`);

    if (responsesNeedingUpdate.length === 0) {
      console.log('✨ No responses need updating!');
      return;
    }

    let updated = 0;
    let skipped = 0;

    for (const response of responsesNeedingUpdate) {
      // Use completedAt if available, otherwise use createdAt
      const emailCapturedAt = response.completedAt || response.createdAt;

      if (!emailCapturedAt) {
        console.log(`⚠️  Skipping response ${response._id}: No suitable date found`);
        skipped++;
        continue;
      }

      await QuizResponse.updateOne(
        { _id: response._id },
        { $set: { emailCapturedAt } }
      );

      updated++;
      
      if (updated % 10 === 0) {
        console.log(`📝 Updated ${updated}/${responsesNeedingUpdate.length} responses...`);
      }
    }

    console.log(`\n✅ Migration complete!`);
    console.log(`   - Updated: ${updated} responses`);
    console.log(`   - Skipped: ${skipped} responses`);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

backfillEmailCapturedAt();

