import { supabase } from '../../../lib/supabase';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
}

export interface Conversation {
  id: string;
  title: string;
  incident_id?: string | null;
  status?: string;
  created_at: string;
  updated_at?: string;
}

async function getAuthHeader(): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      return `Bearer ${session.access_token}`;
    }

    // Fallback: check role-specific local storage keys
    if (typeof window !== 'undefined') {
      const keys = ['aero-session-ambulance', 'aero-session-police', 'aero-session-hospital', 'aero-session-admin', 'aero-session-default'];
      for (const k of keys) {
        const item = localStorage.getItem(k);
        if (item) {
          try {
            const parsed = JSON.parse(item);
            if (parsed.access_token) return `Bearer ${parsed.access_token}`;
          } catch {
            // ignore
          }
        }
      }
    }
  } catch (err) {
    console.warn('[aiService] Failed to retrieve session token:', err);
  }
  return null;
}

export const aiService = {
  /**
   * Send message to authoritative AERO AI backend
   */
  async sendMessage(
    message: string, 
    conversationId: string | null = null, 
    incidentContext?: string | null,
    retryCount = 0
  ): Promise<{ reply: string; conversationId: string }> {
    const authHeader = await getAuthHeader();
    if (!authHeader) {
      throw new Error('Authentication required. Please sign in to consult AERO Intelligence.');
    }

    const response = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader
      },
      body: JSON.stringify({ 
        message, 
        conversationId,
        incidentContext 
      })
    });

    if (!response.ok) {
      if (response.status === 401 && retryCount === 0) {
        // Token might have refreshed, retry once
        return this.sendMessage(message, conversationId, incidentContext, 1);
      }
      
      if (response.status === 401) {
        throw new Error('Your session has expired. Please sign in again.');
      }

      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || errorData.details || 'Failed to communicate with AERO AI.');
    }

    const data = await response.json();
    return {
      reply: data.message.content,
      conversationId: data.conversationId
    };
  },

  /**
   * Load user's conversations from authoritative backend
   */
  async loadConversations(): Promise<Conversation[]> {
    const authHeader = await getAuthHeader();
    if (!authHeader) return [];

    try {
      const res = await fetch('/api/ai/conversations', {
        headers: { 'Authorization': authHeader }
      });
      if (!res.ok) {
        console.warn('[aiService] Failed to load conversations:', res.statusText);
        return [];
      }
      const data = await res.json();
      return data.conversations || [];
    } catch (err) {
      console.warn('[aiService] Error fetching conversations:', err);
      return [];
    }
  },

  /**
   * Load verified messages for an active conversation
   */
  async loadMessages(conversationId: string): Promise<ChatMessage[]> {
    const authHeader = await getAuthHeader();
    if (!authHeader || !conversationId) return [];

    try {
      const res = await fetch(`/api/ai/conversations/${conversationId}/messages`, {
        headers: { 'Authorization': authHeader }
      });
      if (!res.ok) {
        console.warn('[aiService] Failed to load messages:', res.statusText);
        return [];
      }
      const data = await res.json();
      return (data.messages || []).map((m: any) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        created_at: m.created_at
      }));
    } catch (err) {
      console.warn('[aiService] Error fetching messages:', err);
      return [];
    }
  },

  /**
   * Delete an authorized conversation
   */
  async deleteConversation(conversationId: string): Promise<boolean> {
    const authHeader = await getAuthHeader();
    if (!authHeader || !conversationId) return false;

    try {
      const res = await fetch(`/api/ai/conversations/${conversationId}`, {
        method: 'DELETE',
        headers: { 'Authorization': authHeader }
      });
      return res.ok;
    } catch (err) {
      console.error('[aiService] Error deleting conversation:', err);
      return false;
    }
  }
};
