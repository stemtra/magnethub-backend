import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

interface BrevoContactAttributes {
  FIRSTNAME?: string;
  LASTNAME?: string;
  SIGNUP_SOURCE?: string;
  SIGNUP_DATE?: string;
}

interface CreateContactPayload {
  email: string;
  attributes?: BrevoContactAttributes;
  listIds?: number[];
  updateEnabled?: boolean;
}

export class BrevoService {
  private static readonly API_BASE_URL = 'https://api.brevo.com/v3';

  /**
   * Check if Brevo is configured
   */
  private static isConfigured(): boolean {
    return !!config.brevo.apiKey;
  }

  /**
   * Make an authenticated request to the Brevo API
   */
  private static async makeRequest<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    body?: unknown
  ): Promise<T> {
    const response = await fetch(`${this.API_BASE_URL}${endpoint}`, {
      method,
      headers: {
        'api-key': config.brevo.apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Brevo API error (${response.status}): ${errorText}`);
    }

    // Handle 201 Created and 204 No Content responses
    if (response.status === 204 || response.headers.get('content-length') === '0') {
      return {} as T;
    }

    return response.json() as Promise<T>;
  }

  /**
   * Create a contact in Brevo when a user signs up
   */
  static async createContact(
    email: string,
    name?: string,
    source: string = 'google_oauth'
  ): Promise<{ id?: number } | null> {
    if (!this.isConfigured()) {
      logger.warn('Brevo API key not configured - skipping contact creation');
      return null;
    }

    try {
      // Parse first and last name from display name
      const nameParts = name?.trim().split(/\s+/) || [];
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';

      const payload: CreateContactPayload = {
        email,
        attributes: {
          FIRSTNAME: firstName,
          LASTNAME: lastName,
          SIGNUP_SOURCE: source,
          SIGNUP_DATE: new Date().toISOString().split('T')[0], // YYYY-MM-DD format
        },
        updateEnabled: true, // Update if contact already exists
      };

      logger.info(`Creating Brevo contact for ${email}`);
      const result = await this.makeRequest<{ id: number }>('/contacts', 'POST', payload);
      logger.info(`Brevo contact created successfully for ${email}`, { contactId: result.id });
      
      return result;
    } catch (error) {
      logger.error('Failed to create Brevo contact:', error as Error);
      // Don't throw - we don't want to fail user signup if Brevo fails
      return null;
    }
  }

  /**
   * Update a contact's attributes in Brevo
   */
  static async updateContact(
    email: string,
    attributes: BrevoContactAttributes
  ): Promise<boolean> {
    if (!this.isConfigured()) {
      logger.warn('Brevo API key not configured - skipping contact update');
      return false;
    }

    try {
      logger.info(`Updating Brevo contact for ${email}`);
      await this.makeRequest(`/contacts/${encodeURIComponent(email)}`, 'PUT', { attributes });
      logger.info(`Brevo contact updated successfully for ${email}`);
      return true;
    } catch (error) {
      logger.error('Failed to update Brevo contact:', error as Error);
      return false;
    }
  }
}
