-- ==============================================================================
-- AERO — AI CONVERSATIONS & MESSAGES MIGRATION
-- Migration: 20261020_create_ai_conversations_and_messages.sql
-- Description: Creates public.ai_conversations and public.ai_messages tables
-- with UUID keys, foreign key constraints, RLS policies, cascading deletes,
-- and performance indexes for conversational history persistence.
-- ==============================================================================

-- 1. Create ai_conversations table
CREATE TABLE IF NOT EXISTS public.ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL DEFAULT 'Emergency Chat',
  incident_id UUID REFERENCES public.emergency_incidents(id) ON DELETE SET NULL,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'archived', 'closed')),
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Create ai_messages table
CREATE TABLE IF NOT EXISTS public.ai_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES public.ai_conversations(id) ON DELETE CASCADE NOT NULL,
  user_id UUID NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies for ai_conversations
DO $$ 
BEGIN
  -- Select policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE policyname = 'Users can view own conversations' AND tablename = 'ai_conversations'
  ) THEN
    CREATE POLICY "Users can view own conversations" 
    ON public.ai_conversations FOR SELECT 
    TO authenticated 
    USING (auth.uid() = user_id);
  END IF;

  -- Insert policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE policyname = 'Users can insert own conversations' AND tablename = 'ai_conversations'
  ) THEN
    CREATE POLICY "Users can insert own conversations" 
    ON public.ai_conversations FOR INSERT 
    TO authenticated 
    WITH CHECK (auth.uid() = user_id);
  END IF;

  -- Update policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE policyname = 'Users can update own conversations' AND tablename = 'ai_conversations'
  ) THEN
    CREATE POLICY "Users can update own conversations" 
    ON public.ai_conversations FOR UPDATE 
    TO authenticated 
    USING (auth.uid() = user_id);
  END IF;

  -- Delete policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE policyname = 'Users can delete own conversations' AND tablename = 'ai_conversations'
  ) THEN
    CREATE POLICY "Users can delete own conversations" 
    ON public.ai_conversations FOR DELETE 
    TO authenticated 
    USING (auth.uid() = user_id);
  END IF;
END $$;

-- 5. RLS Policies for ai_messages
DO $$ 
BEGIN
  -- Select policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE policyname = 'Users can view own messages' AND tablename = 'ai_messages'
  ) THEN
    CREATE POLICY "Users can view own messages" 
    ON public.ai_messages FOR SELECT 
    TO authenticated 
    USING (auth.uid() = user_id);
  END IF;

  -- Insert policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE policyname = 'Users can insert own messages' AND tablename = 'ai_messages'
  ) THEN
    CREATE POLICY "Users can insert own messages" 
    ON public.ai_messages FOR INSERT 
    TO authenticated 
    WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- 6. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_ai_conversations_user ON public.ai_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_incident ON public.ai_conversations(incident_id);
CREATE INDEX IF NOT EXISTS idx_ai_messages_conv_created ON public.ai_messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_ai_messages_user ON public.ai_messages(user_id);

-- 7. Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
