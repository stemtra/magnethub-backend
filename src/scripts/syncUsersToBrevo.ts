import { connectDatabase, disconnectDatabase } from '../utils/database.js';
import { User } from '../models/User.js';
import { BrevoService } from '../services/brevoService.js';
import { logger } from '../utils/logger.js';

/**
 * Script to sync existing users from production database to Brevo automation
 * Skips the first 4 users as they were created before the automation
 */
async function syncUsersToBrevo() {
  try {
    logger.info('Starting Brevo user sync...');
    
    // Connect to database
    await connectDatabase();
    
    // Fetch all users, sorted by creation date (oldest first), skip first 4
    const users = await User.find({})
      .sort({ createdAt: 1 })
      .skip(4)
      .select('email name createdAt');
    
    logger.info(`Found ${users.length} users to sync (excluding first 4)`);
    
    let successCount = 0;
    let failureCount = 0;
    let skippedCount = 0;
    
    // Process each user
    for (const user of users) {
      try {
        // Determine signup source
        const signupSource = 'email_password';
        
        logger.info(`Processing user: ${user.email}`);
        
        // Add to Brevo
        const result = await BrevoService.createContact(
          user.email,
          user.name,
          'email_password'
        );
        
        if (result) {
          successCount++;
          logger.info(`✅ Successfully added ${user.email} to Brevo`);
        } else {
          skippedCount++;
          logger.warn(`⚠️ Skipped ${user.email} (Brevo not configured or other issue)`);
        }
        
        // Add a small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        failureCount++;
        logger.error(`❌ Failed to add ${user.email} to Brevo:`, error);
      }
    }
    
    // Summary
    logger.info('');
    logger.info('='.repeat(50));
    logger.info('Brevo Sync Complete!');
    logger.info('='.repeat(50));
    logger.info(`Total users processed: ${users.length}`);
    logger.info(`Successfully added: ${successCount}`);
    logger.info(`Failed: ${failureCount}`);
    logger.info(`Skipped: ${skippedCount}`);
    logger.info('='.repeat(50));
    
  } catch (error) {
    logger.error('Fatal error during Brevo sync:', error);
    throw error;
  } finally {
    // Disconnect from database
    await disconnectDatabase();
  }
}

// Run the script
syncUsersToBrevo()
  .then(() => {
    logger.info('Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Script failed:', error);
    process.exit(1);
  });
