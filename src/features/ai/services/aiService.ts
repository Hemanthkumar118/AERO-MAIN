import { supabase } from '../../../lib/supabase';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
}

export const aiService = {
  async sendMessage(message: string, conversationId: string | null, retryCount = 0): Promise<{ reply: string, conversationId: string }> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');

    const response = await fetch('http://localhost:3001/api/ai/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ message, conversationId })
    });

    if (!response.ok) {
      if (response.status === 401 && retryCount === 0) {
        // Token might have expired, try fetching fresh session and retry once
        return this.sendMessage(message, conversationId, 1);
      }
      
      if (response.status === 401) {
        throw new Error('Your AERO session has expired. Please sign in again.');
      }

      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to communicate with AERO AI.');
    }

    const data = await response.json();
    return {
      reply: data.message.content,
      conversationId: data.conversationId
    };
  },

  async loadConversations() {
    const { data, error } = await supabase
      .from('ai_conversations')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data;
  },

  async loadMessages(conversationId: string) {
    const { data, error } = await supabase
      .from('ai_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    
    if (error) throw error;
    return data;
  },

  async deleteConversation(conversationId: string) {
    const { error } = await supabase
      .from('ai_conversations')
      .delete()
      .eq('id', conversationId);
    
    if (error) throw error;
  },

  async renameConversation(conversationId: string, title: string) {
    const { error } = await supabase
      .from('ai_conversations')
      .update({ title })
      .eq('id', conversationId);
    
    if (error) throw error;
  }
};
