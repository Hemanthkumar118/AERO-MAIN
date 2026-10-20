import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'ai_store.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// In-memory / file-persisted resilient store
function loadLocalStore() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const data = fs.readFileSync(STORE_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.warn('[AI Store] Failed to read store file, reinitializing:', err);
  }
  return { conversations: {}, messages: [] };
}

function saveLocalStore(store) {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    console.error('[AI Store] Failed to write store file:', err);
  }
}

export const aiStore = {
  /**
   * Get all conversations for a user
   */
  async getConversations(userId, userSupabase) {
    // 1. Try Supabase remote table first
    if (userSupabase) {
      try {
        const { data, error } = await userSupabase
          .from('ai_conversations')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false });

        if (!error && data) {
          return data;
        }
        if (error && error.code !== 'PGRST205') {
          console.warn('[AI Store] Remote Supabase query returned non-205 error:', error.message);
        }
      } catch (err) {
        // Fall through to local persistent store
      }
    }

    // 2. Fallback to resilient server-side persistent store
    const store = loadLocalStore();
    return Object.values(store.conversations)
      .filter(c => c.user_id === userId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  },

  /**
   * Get a single conversation by ID
   */
  async getConversation(conversationId, userId, userSupabase) {
    if (userSupabase) {
      try {
        const { data, error } = await userSupabase
          .from('ai_conversations')
          .select('*')
          .eq('id', conversationId)
          .eq('user_id', userId)
          .maybeSingle();

        if (!error && data) {
          return data;
        }
      } catch (err) {
        // Fall through
      }
    }

    const store = loadLocalStore();
    const conv = store.conversations[conversationId];
    if (conv && conv.user_id === userId) {
      return conv;
    }
    return null;
  },

  /**
   * Create or initialize a conversation
   */
  async createConversation(userId, payload, userSupabase) {
    const now = new Date().toISOString();
    const record = {
      id: payload.id,
      user_id: userId,
      title: payload.title || `Emergency Chat ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      incident_id: payload.incident_id || null,
      status: 'active',
      created_at: now,
      updated_at: now
    };

    // 1. Try Supabase
    if (userSupabase) {
      try {
        const { data, error } = await userSupabase
          .from('ai_conversations')
          .insert(record)
          .select()
          .maybeSingle();

        if (!error && data) {
          return data;
        }
        if (error && error.code === 'PGRST205') {
          console.warn('[AI Store] Notice: public.ai_conversations table does not exist in Supabase yet. Persisting conversation in server storage. Run migration 20261020_create_ai_conversations_and_messages.sql to enable cloud sync.');
        }
      } catch (err) {
        // Fall through
      }
    }

    // 2. Fallback to server persistent store
    const store = loadLocalStore();
    store.conversations[record.id] = record;
    saveLocalStore(store);
    return record;
  },

  /**
   * Get all messages for a conversation
   */
  async getMessages(conversationId, userId, userSupabase) {
    if (userSupabase) {
      try {
        const { data, error } = await userSupabase
          .from('ai_messages')
          .select('*')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: true });

        if (!error && data) {
          return data;
        }
      } catch (err) {
        // Fall through
      }
    }

    const store = loadLocalStore();
    return store.messages
      .filter(m => m.conversation_id === conversationId)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  },

  /**
   * Save a message (user or assistant)
   */
  async saveMessage(message, userSupabase) {
    const record = {
      ...message,
      created_at: new Date().toISOString()
    };

    if (userSupabase) {
      try {
        const { data, error } = await userSupabase
          .from('ai_messages')
          .insert(record)
          .select()
          .maybeSingle();

        if (!error && data) {
          return data;
        }
      } catch (err) {
        // Fall through
      }
    }

    const store = loadLocalStore();
    // Prevent duplicate insertion
    if (!store.messages.some(m => m.id === record.id)) {
      store.messages.push(record);
      saveLocalStore(store);
    }
    return record;
  },

  /**
   * Delete a conversation and its messages
   */
  async deleteConversation(conversationId, userId, userSupabase) {
    if (userSupabase) {
      try {
        const { error } = await userSupabase
          .from('ai_conversations')
          .delete()
          .eq('id', conversationId)
          .eq('user_id', userId);

        if (!error) return true;
      } catch (err) {
        // Fall through
      }
    }

    const store = loadLocalStore();
    if (store.conversations[conversationId] && store.conversations[conversationId].user_id === userId) {
      delete store.conversations[conversationId];
      store.messages = store.messages.filter(m => m.conversation_id !== conversationId);
      saveLocalStore(store);
      return true;
    }
    return false;
  },

  /**
   * Rename conversation title
   */
  async renameConversation(conversationId, title, userId, userSupabase) {
    if (userSupabase) {
      try {
        const { error } = await userSupabase
          .from('ai_conversations')
          .update({ title, updated_at: new Date().toISOString() })
          .eq('id', conversationId)
          .eq('user_id', userId);

        if (!error) return true;
      } catch (err) {
        // Fall through
      }
    }

    const store = loadLocalStore();
    if (store.conversations[conversationId] && store.conversations[conversationId].user_id === userId) {
      store.conversations[conversationId].title = title;
      store.conversations[conversationId].updated_at = new Date().toISOString();
      saveLocalStore(store);
      return true;
    }
    return false;
  }
};
