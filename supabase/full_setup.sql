-- ============================================================
-- AERO Full Database Setup
-- Run this ONCE in your Supabase Dashboard → SQL Editor
-- https://supabase.com/dashboard/project/xznpuhpfnobiwiwvsmev/sql/new
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. PROFILES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  full_name TEXT,
  email TEXT UNIQUE,
  role TEXT DEFAULT 'user' CHECK (role IN ('ambulance_operator', 'traffic_operator', 'hospital_operator', 'admin', 'user')),
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (new.id, new.raw_user_meta_data->>'full_name', new.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created') THEN
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
  END IF;
END
$$;

-- ============================================================
-- 2. EMERGENCY INCIDENTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.emergency_incidents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id),
  incident_type TEXT NOT NULL DEFAULT 'GENERAL',
  priority TEXT CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'dispatched', 'en_route', 'arrived', 'resolved', 'cancelled')),
  ambulance_id TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  destination_hospital TEXT,
  destination_address TEXT,
  destination_latitude DOUBLE PRECISION,
  destination_longitude DOUBLE PRECISION,
  eta_minutes INTEGER,
  route_status TEXT,
  description TEXT,
  -- Corridor columns
  route_geometry JSONB,
  route_distance_meters DOUBLE PRECISION,
  route_duration_seconds DOUBLE PRECISION,
  current_latitude DOUBLE PRECISION,
  current_longitude DOUBLE PRECISION,
  current_accuracy DOUBLE PRECISION,
  current_speed DOUBLE PRECISION,
  current_heading DOUBLE PRECISION,
  corridor_status TEXT DEFAULT 'PENDING' CHECK (corridor_status IN ('PENDING', 'CLEARING', 'CLEAR', 'CAUTION', 'BLOCKED')),
  police_acknowledged_at TIMESTAMP WITH TIME ZONE,
  police_id UUID REFERENCES auth.users(id),
  resolved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ============================================================
-- 3. AI CHAT HISTORY TABLES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ai_conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  title TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.ai_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID REFERENCES public.ai_conversations(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  role TEXT CHECK (role IN ('user', 'assistant', 'system')) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ============================================================
-- 4. ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emergency_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;

-- Profiles policies
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view own profile' AND tablename = 'profiles') THEN
    CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can update own profile' AND tablename = 'profiles') THEN
    CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
  END IF;
END $$;

-- Emergency incident policies (ambulance operators)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view their incidents' AND tablename = 'emergency_incidents') THEN
    CREATE POLICY "Users can view their incidents" ON public.emergency_incidents FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can insert incidents' AND tablename = 'emergency_incidents') THEN
    CREATE POLICY "Users can insert incidents" ON public.emergency_incidents FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can update their incidents' AND tablename = 'emergency_incidents') THEN
    CREATE POLICY "Users can update their incidents" ON public.emergency_incidents FOR UPDATE USING (auth.uid() = user_id);
  END IF;
END $$;

-- Traffic police policies
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Traffic Police can view all incidents' AND tablename = 'emergency_incidents') THEN
    CREATE POLICY "Traffic Police can view all incidents"
    ON public.emergency_incidents FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
        AND profiles.role IN ('traffic_operator', 'admin')
      )
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Traffic Police can update incidents' AND tablename = 'emergency_incidents') THEN
    CREATE POLICY "Traffic Police can update incidents"
    ON public.emergency_incidents FOR UPDATE
    USING (
      EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
        AND profiles.role IN ('traffic_operator', 'admin')
      )
    );
  END IF;
END $$;

-- AI conversation policies
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view own conversations' AND tablename = 'ai_conversations') THEN
    CREATE POLICY "Users can view own conversations" ON public.ai_conversations FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can insert own conversations' AND tablename = 'ai_conversations') THEN
    CREATE POLICY "Users can insert own conversations" ON public.ai_conversations FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can update own conversations' AND tablename = 'ai_conversations') THEN
    CREATE POLICY "Users can update own conversations" ON public.ai_conversations FOR UPDATE USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can delete own conversations' AND tablename = 'ai_conversations') THEN
    CREATE POLICY "Users can delete own conversations" ON public.ai_conversations FOR DELETE USING (auth.uid() = user_id);
  END IF;
END $$;

-- AI messages policies
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view own messages' AND tablename = 'ai_messages') THEN
    CREATE POLICY "Users can view own messages" ON public.ai_messages FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can insert own messages' AND tablename = 'ai_messages') THEN
    CREATE POLICY "Users can insert own messages" ON public.ai_messages FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- ============================================================
-- 5. INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_incidents_user_id ON public.emergency_incidents(user_id);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON public.emergency_incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_police_id ON public.emergency_incidents(police_id);
CREATE INDEX IF NOT EXISTS idx_incidents_updated_at ON public.emergency_incidents(updated_at);
CREATE INDEX IF NOT EXISTS idx_ai_conv_user_id ON public.ai_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_msg_conv_id ON public.ai_messages(conversation_id);

-- ============================================================
-- 6. UPDATED_AT TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_emergency_incidents_modtime') THEN
    CREATE TRIGGER update_emergency_incidents_modtime
    BEFORE UPDATE ON public.emergency_incidents
    FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_profiles_modtime') THEN
    CREATE TRIGGER update_profiles_modtime
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column();
  END IF;
END $$;

-- ============================================================
-- 7. REALTIME
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND schemaname = 'public'
    AND tablename = 'emergency_incidents'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.emergency_incidents;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'supabase_realtime publication not available.';
END;
$$;
- -   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =  
 - -   A E R O   D a t a b a s e   F o u n d a t i o n   ( P o s t G I S ,   C o r e   E n t i t i e s ,   R L S )  
 - -   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =  
  
 - -   0 .   E n a b l e   P o s t G I S   E x t e n s i o n  
 C R E A T E   E X T E N S I O N   I F   N O T   E X I S T S   p o s t g i s   W I T H   S C H E M A   p u b l i c ;  
  
 - -   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =  
 - -   1 .   H O S P I T A L S  
 - -   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =  
 C R E A T E   T A B L E   I F   N O T   E X I S T S   p u b l i c . h o s p i t a l s   (  
     i d   U U I D   P R I M A R Y   K E Y   D E F A U L T   u u i d _ g e n e r a t e _ v 4 ( ) ,  
     n a m e   T E X T   N O T   N U L L ,  
     a d d r e s s   T E X T ,  
     l o c a t i o n   g e o m e t r y ( P o i n t ,   4 3 2 6 ) ,  
     p h o n e   T E X T ,  
     e m e r g e n c y _ c a p a b l e   B O O L E A N   D E F A U L T   t r u e ,  
     t o t a l _ b e d s   I N T E G E R ,  
     a v a i l a b l e _ i c u _ b e d s   I N T E G E R ,  
     t r a u m a _ b a y s _ a v a i l a b l e   I N T E G E R ,  
     c r e a t e d _ a t   T I M E S T A M P   W I T H   T I M E   Z O N E   D E F A U L T   t i m e z o n e ( ' u t c ' : : t e x t ,   n o w ( ) )   N O T   N U L L ,  
     u p d a t e d _ a t   T I M E S T A M P   W I T H   T I M E   Z O N E   D E F A U L T   t i m e z o n e ( ' u t c ' : : t e x t ,   n o w ( ) )   N O T   N U L L  
 ) ;  
  
 - -   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =  
 - -   2 .   A M B U L A N C E S  
 - -   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =  
 C R E A T E   T A B L E   I F   N O T   E X I S T S   p u b l i c . a m b u l a n c e s   (  
     i d   U U I D   P R I M A R Y   K E Y   D E F A U L T   u u i d _ g e n e r a t e _ v 4 ( ) ,  
     v e h i c l e _ n u m b e r   T E X T   U N I Q U E   N O T   N U L L ,  
     h o s p i t a l _ i d   U U I D   R E F E R E N C E S   p u b l i c . h o s p i t a l s ( i d ) ,  
     d r i v e r _ i d   U U I D   R E F E R E N C E S   a u t h . u s e r s ( i d ) ,  
     e q u i p m e n t _ l e v e l   T E X T   C H E C K   ( e q u i p m e n t _ l e v e l   I N   ( ' B L S ' ,   ' A L S ' ,   ' I C U ' ) ) ,  
     c u r r e n t _ s t a t u s   T E X T   D E F A U L T   ' A V A I L A B L E '   C H E C K   ( c u r r e n t _ s t a t u s   I N   ( ' A V A I L A B L E ' ,   ' U N A V A I L A B L E ' ,   ' B U S Y ' ,   ' E N _ R O U T E ' ) ) ,  
     l o c a t i o n   g e o m e t r y ( P o i n t ,   4 3 2 6 ) ,  
     c r e a t e d _ a t   T I M E S T A M P   W I T H   T I M E   Z O N E   D E F A U L T   t i m e z o n e ( ' u t c ' : : t e x t ,   n o w ( ) )   N O T   N U L L ,  
     u p d a t e d _ a t   T I M E S T A M P   W I T H   T I M E   Z O N E   D E F A U L T   t i m e z o n e ( ' u t c ' : : t e x t ,   n o w ( ) )   N O T   N U L L  
 ) ;  
  
 - -   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =  
 - -   3 .   J U N C T I O N S  
 - -   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =  
 C R E A T E   T A B L E   I F   N O T   E X I S T S   p u b l i c . j u n c t i o n s   (  
     i d   U U I D   P R I M A R Y   K E Y   D E F A U L T   u u i d _ g e n e r a t e _ v 4 ( ) ,  
     n a m e   T E X T   N O T   N U L L ,  
     l o c a t i o n   g e o m e t r y ( P o i n t ,   4 3 2 6 )   N O T   N U L L ,  
     s t a t u s   T E X T   D E F A U L T   ' N O R M A L '   C H E C K   ( s t a t u s   I N   ( ' N O R M A L ' ,   ' P R E P A R I N G ' ,   ' C L E A R E D ' ,   ' P A S S E D ' ) ) ,  
     a s s i g n e d _ p o l i c e _ i d   U U I D   R E F E R E N C E S   a u t h . u s e r s ( i d ) ,  
     c r e a t e d _ a t   T I M E S T A M P   W I T H   T I M E   Z O N E   D E F A U L T   t i m e z o n e ( ' u t c ' : : t e x t ,   n o w ( ) )   N O T   N U L L ,  
     u p d a t e d _ a t   T I M E S T A M P   W I T H   T I M E   Z O N E   D E F A U L T   t i m e z o n e ( ' u t c ' : : t e x t ,   n o w ( ) )   N O T   N U L L  
 ) ;  
  
 - -   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =  
 - -   4 .   T R A F F I C   I N C I D E N T S  
 - -   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =  
 C R E A T E   T A B L E   I F   N O T   E X I S T S   p u b l i c . t r a f f i c _ i n c i d e n t s   (  
     i d   U U I D   P R I M A R Y   K E Y   D E F A U L T   u u i d _ g e n e r a t e _ v 4 ( ) ,  
     t y p e   T E X T   C H E C K   ( t y p e   I N   ( ' A C C I D E N T ' ,   ' R O A D _ B L O C K A G E ' ,   ' C O N G E S T I O N ' ,   ' C O N S T R U C T I O N ' ,   ' W A T E R L O G G I N G ' ) ) ,  
     s e v e r i t y   T E X T   C H E C K   ( s e v e r i t y   I N   ( ' L O W ' ,   ' M E D I U M ' ,   ' H I G H ' ,   ' C R I T I C A L ' ) ) ,  
     t i t l e   T E X T   N O T   N U L L ,  
     d e s c r i p t i o n   T E X T ,  
     l o c a t i o n   g e o m e t r y ( P o i n t ,   4 3 2 6 )   N O T   N U L L ,  
     r e p o r t e d _ b y   U U I D   R E F E R E N C E S   a u t h . u s e r s ( i d ) ,  
     a c t i v e   B O O L E A N   D E F A U L T   t r u e ,  
     c r e a t e d _ a t   T I M E S T A M P   W I T H   T I M E   Z O N E   D E F A U L T   t i m e z o n e ( ' u t c ' : : t e x t ,   n o w ( ) )   N O T   N U L L ,  
     u p d a t e d _ a t   T I M E S T A M P   W I T H   T I M E   Z O N E   D E F A U L T   t i m e z o n e ( ' u t c ' : : t e x t ,   n o w ( ) )   N O T   N U L L  
 ) ;  
  
 - -   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =  
 - -   5 .   L O C A T I O N   T E L E M E T R Y  
 - -   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =  
 C R E A T E   T A B L E   I F   N O T   E X I S T S   p u b l i c . l o c a t i o n _ t e l e m e t r y   (  
     i d   U U I D   P R I M A R Y   K E Y   D E F A U L T   u u i d _ g e n e r a t e _ v 4 ( ) ,  
     e n t i t y _ i d   U U I D   N O T   N U L L ,   - -   a m b u l a n c e _ i d   o r   p o l i c e _ i d  
     e n t i t y _ t y p e   T E X T   C H E C K   ( e n t i t y _ t y p e   I N   ( ' A M B U L A N C E ' ,   ' P O L I C E ' ) ) ,  
     l o c a t i o n   g e o m e t r y ( P o i n t ,   4 3 2 6 )   N O T   N U L L ,  
     a c c u r a c y   D O U B L E   P R E C I S I O N ,  
     s p e e d   D O U B L E   P R E C I S I O N ,  
     h e a d i n g   D O U B L E   P R E C I S I O N ,  
     t i m e s t a m p   T I M E S T A M P   W I T H   T I M E   Z O N E   D E F A U L T   t i m e z o n e ( ' u t c ' : : t e x t ,   n o w ( ) )   N O T   N U L L  
 ) ;  
  
 - -   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =  
 - -   6 .   R O U T E S  
 - -   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =  
 C R E A T E   T A B L E   I F   N O T   E X I S T S   p u b l i c . r o u t e s   (  
     i d   U U I D   P R I M A R Y   K E Y   D E F A U L T   u u i d _ g e n e r a t e _ v 4 ( ) ,  
     e m e r g e n c y _ i d   U U I D   R E F E R E N C E S   p u b l i c . e m e r g e n c y _ i n c i d e n t s ( i d )   O N   D E L E T E   C A S C A D E ,  
     p o l y l i n e   g e o m e t r y ( L i n e S t r i n g ,   4 3 2 6 ) ,  
     d i s t a n c e _ m e t e r s   D O U B L E   P R E C I S I O N ,  
     e t a _ s e c o n d s   I N T E G E R ,  
     c r e a t e d _ a t   T I M E S T A M P   W I T H   T I M E   Z O N E   D E F A U L T   t i m e z o n e ( ' u t c ' : : t e x t ,   n o w ( ) )   N O T   N U L L  
 ) ;  
  
 - -   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =  
 - -   7 .   N O T I F I C A T I O N S  
 - -   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =  
 C R E A T E   T A B L E   I F   N O T   E X I S T S   p u b l i c . n o t i f i c a t i o n s   (  
     i d   U U I D   P R I M A R Y   K E Y   D E F A U L T   u u i d _ g e n e r a t e _ v 4 ( ) ,  
     u s e r _ i d   U U I D   R E F E R E N C E S   a u t h . u s e r s ( i d ) ,  
     t i t l e   T E X T   N O T   N U L L ,  
     m e s s a g e   T E X T   N O T   N U L L ,  
     t y p e   T E X T ,  
     r e a d   B O O L E A N   D E F A U L T   f a l s e ,  
     c r e a t e d _ a t   T I M E S T A M P   W I T H   T I M E   Z O N E   D E F A U L T   t i m e z o n e ( ' u t c ' : : t e x t ,   n o w ( ) )   N O T   N U L L  
 ) ;  
  
 - -   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =  
 - -   8 .   P O L I C E   A S S I G N M E N T S  
 - -   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =  
 C R E A T E   T A B L E   I F   N O T   E X I S T S   p u b l i c . p o l i c e _ a s s i g n m e n t s   (  
     i d   U U I D   P R I M A R Y   K E Y   D E F A U L T   u u i d _ g e n e r a t e _ v 4 ( ) ,  
     p o l i c e _ i d   U U I D   R E F E R E N C E S   a u t h . u s e r s ( i d )   N O T   N U L L ,  
     j u n c t i o n _ i d   U U I D   R E F E R E N C E S   p u b l i c . j u n c t i o n s ( i d ) ,  
     e m e r g e n c y _ i d   U U I D   R E F E R E N C E S   p u b l i c . e m e r g e n c y _ i n c i d e n t s ( i d ) ,  
     s t a t u s   T E X T   D E F A U L T   ' A C T I V E '   C H E C K   ( s t a t u s   I N   ( ' A C T I V E ' ,   ' C O M P L E T E D ' ,   ' C A N C E L L E D ' ) ) ,  
     a s s i g n e d _ a t   T I M E S T A M P   W I T H   T I M E   Z O N E   D E F A U L T   t i m e z o n e ( ' u t c ' : : t e x t ,   n o w ( ) )   N O T   N U L L  
 ) ;  
  
 - -   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =  
 - -   9 .   E M E R G E N C Y   S T A T U S   L O G S  
 - -   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =  
 C R E A T E   T A B L E   I F   N O T   E X I S T S   p u b l i c . e m e r g e n c y _ s t a t u s _ l o g s   (  
     i d   U U I D   P R I M A R Y   K E Y   D E F A U L T   u u i d _ g e n e r a t e _ v 4 ( ) ,  
     e m e r g e n c y _ i d   U U I D   R E F E R E N C E S   p u b l i c . e m e r g e n c y _ i n c i d e n t s ( i d )   O N   D E L E T E   C A S C A D E ,  
     s t a t u s   T E X T   N O T   N U L L ,  
     c h a n g e d _ b y   U U I D   R E F E R E N C E S   a u t h . u s e r s ( i d ) ,  
     n o t e s   T E X T ,  
     c r e a t e d _ a t   T I M E S T A M P   W I T H   T I M E   Z O N E   D E F A U L T   t i m e z o n e ( ' u t c ' : : t e x t ,   n o w ( ) )   N O T   N U L L  
 ) ;  
  
 - -   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =  
 - -   E X T E N D   P R O F I L E S  
 - -   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =  
 A L T E R   T A B L E   p u b l i c . p r o f i l e s   A D D   C O L U M N   I F   N O T   E X I S T S   b a d g e _ n u m b e r   T E X T ;  
 A L T E R   T A B L E   p u b l i c . p r o f i l e s   A D D   C O L U M N   I F   N O T   E X I S T S   s t a t i o n _ n a m e   T E X T ;  
  
 - -   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =  
 - -   R O W   L E V E L   S E C U R I T Y  
 - -   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =  
 A L T E R   T A B L E   p u b l i c . h o s p i t a l s   E N A B L E   R O W   L E V E L   S E C U R I T Y ;  
 A L T E R   T A B L E   p u b l i c . a m b u l a n c e s   E N A B L E   R O W   L E V E L   S E C U R I T Y ;  
 A L T E R   T A B L E   p u b l i c . j u n c t i o n s   E N A B L E   R O W   L E V E L   S E C U R I T Y ;  
 A L T E R   T A B L E   p u b l i c . t r a f f i c _ i n c i d e n t s   E N A B L E   R O W   L E V E L   S E C U R I T Y ;  
 A L T E R   T A B L E   p u b l i c . l o c a t i o n _ t e l e m e t r y   E N A B L E   R O W   L E V E L   S E C U R I T Y ;  
 A L T E R   T A B L E   p u b l i c . r o u t e s   E N A B L E   R O W   L E V E L   S E C U R I T Y ;  
 A L T E R   T A B L E   p u b l i c . n o t i f i c a t i o n s   E N A B L E   R O W   L E V E L   S E C U R I T Y ;  
 A L T E R   T A B L E   p u b l i c . p o l i c e _ a s s i g n m e n t s   E N A B L E   R O W   L E V E L   S E C U R I T Y ;  
 A L T E R   T A B L E   p u b l i c . e m e r g e n c y _ s t a t u s _ l o g s   E N A B L E   R O W   L E V E L   S E C U R I T Y ;  
  
 - -   H o s p i t a l s :   A n y o n e   c a n   r e a d ,   o n l y   h o s p i t a l   o p e r a t o r s   c a n   u p d a t e  
 C R E A T E   P O L I C Y   " P u b l i c   c a n   v i e w   h o s p i t a l s "   O N   p u b l i c . h o s p i t a l s   F O R   S E L E C T   U S I N G   ( t r u e ) ;  
 C R E A T E   P O L I C Y   " H o s p i t a l   o p e r a t o r s   c a n   u p d a t e "   O N   p u b l i c . h o s p i t a l s   F O R   U P D A T E   U S I N G   (  
     E X I S T S   ( S E L E C T   1   F R O M   p u b l i c . p r o f i l e s   W H E R E   p r o f i l e s . i d   =   a u t h . u i d ( )   A N D   p r o f i l e s . r o l e   I N   ( ' h o s p i t a l _ o p e r a t o r ' ,   ' a d m i n ' ) )  
 ) ;  
  
 - -   A m b u l a n c e s :   P u b l i c   c a n   v i e w ,   a m b u l a n c e   o p e r a t o r s   c a n   u p d a t e  
 C R E A T E   P O L I C Y   " P u b l i c   c a n   v i e w   a m b u l a n c e s "   O N   p u b l i c . a m b u l a n c e s   F O R   S E L E C T   U S I N G   ( t r u e ) ;  
 C R E A T E   P O L I C Y   " A m b u l a n c e   o p e r a t o r s   u p d a t e   o w n "   O N   p u b l i c . a m b u l a n c e s   F O R   U P D A T E   U S I N G   ( d r i v e r _ i d   =   a u t h . u i d ( )   O R   E X I S T S   ( S E L E C T   1   F R O M   p u b l i c . p r o f i l e s   W H E R E   p r o f i l e s . i d   =   a u t h . u i d ( )   A N D   p r o f i l e s . r o l e   =   ' a d m i n ' ) ) ;  
  
 - -   J u n c t i o n s :   P u b l i c   v i e w ,   T r a f f i c   p o l i c e   u p d a t e  
 C R E A T E   P O L I C Y   " P u b l i c   c a n   v i e w   j u n c t i o n s "   O N   p u b l i c . j u n c t i o n s   F O R   S E L E C T   U S I N G   ( t r u e ) ;  
 C R E A T E   P O L I C Y   " T r a f f i c   P o l i c e   c a n   u p d a t e   j u n c t i o n s "   O N   p u b l i c . j u n c t i o n s   F O R   U P D A T E   U S I N G   (  
     E X I S T S   ( S E L E C T   1   F R O M   p u b l i c . p r o f i l e s   W H E R E   p r o f i l e s . i d   =   a u t h . u i d ( )   A N D   p r o f i l e s . r o l e   I N   ( ' t r a f f i c _ o p e r a t o r ' ,   ' a d m i n ' ) )  
 ) ;  
  
 - -   T r a f f i c   I n c i d e n t s :   P u b l i c   v i e w ,   A n y o n e   a u t h e n t i c a t e d   c a n   i n s e r t  
 C R E A T E   P O L I C Y   " P u b l i c   c a n   v i e w   t r a f f i c   i n c i d e n t s "   O N   p u b l i c . t r a f f i c _ i n c i d e n t s   F O R   S E L E C T   U S I N G   ( t r u e ) ;  
 C R E A T E   P O L I C Y   " A u t h e n t i c a t e d   u s e r s   c a n   i n s e r t   i n c i d e n t s "   O N   p u b l i c . t r a f f i c _ i n c i d e n t s   F O R   I N S E R T   W I T H   C H E C K   ( a u t h . u i d ( )   I S   N O T   N U L L ) ;  
  
 - -   L o c a t i o n   T e l e m e t r y :   P u b l i c   r e a d ,   E n t i t i e s   c a n   i n s e r t   t h e i r   o w n  
 C R E A T E   P O L I C Y   " P u b l i c   c a n   v i e w   l o c a t i o n   t e l e m e t r y "   O N   p u b l i c . l o c a t i o n _ t e l e m e t r y   F O R   S E L E C T   U S I N G   ( t r u e ) ;  
 C R E A T E   P O L I C Y   " E n t i t i e s   c a n   i n s e r t   t e l e m e t r y "   O N   p u b l i c . l o c a t i o n _ t e l e m e t r y   F O R   I N S E R T   W I T H   C H E C K   ( a u t h . u i d ( )   I S   N O T   N U L L ) ;  
  
 - -   R o u t e s :   P u b l i c   r e a d ,   A m b u l a n c e   i n s e r t / u p d a t e  
 C R E A T E   P O L I C Y   " P u b l i c   c a n   v i e w   r o u t e s "   O N   p u b l i c . r o u t e s   F O R   S E L E C T   U S I N G   ( t r u e ) ;  
 C R E A T E   P O L I C Y   " A m b u l a n c e   c a n   i n s e r t   r o u t e s "   O N   p u b l i c . r o u t e s   F O R   I N S E R T   W I T H   C H E C K   ( a u t h . u i d ( )   I S   N O T   N U L L ) ;  
 C R E A T E   P O L I C Y   " A m b u l a n c e   c a n   u p d a t e   r o u t e s "   O N   p u b l i c . r o u t e s   F O R   U P D A T E   U S I N G   ( a u t h . u i d ( )   I S   N O T   N U L L ) ;  
  
 - -   N o t i f i c a t i o n s :   O n l y   t h e   u s e r   c a n   v i e w / u p d a t e   t h e i r   n o t i f i c a t i o n s  
 C R E A T E   P O L I C Y   " U s e r s   v i e w   o w n   n o t i f i c a t i o n s "   O N   p u b l i c . n o t i f i c a t i o n s   F O R   S E L E C T   U S I N G   ( u s e r _ i d   =   a u t h . u i d ( ) ) ;  
 C R E A T E   P O L I C Y   " U s e r s   u p d a t e   o w n   n o t i f i c a t i o n s "   O N   p u b l i c . n o t i f i c a t i o n s   F O R   U P D A T E   U S I N G   ( u s e r _ i d   =   a u t h . u i d ( ) ) ;  
  
 - -   P o l i c e   A s s i g n m e n t s :   T r a f f i c   p o l i c e   c a n   v i e w   a n d   u p d a t e  
 C R E A T E   P O L I C Y   " T r a f f i c   P o l i c e   c a n   v i e w   a s s i g n m e n t s "   O N   p u b l i c . p o l i c e _ a s s i g n m e n t s   F O R   S E L E C T   U S I N G   (  
     E X I S T S   ( S E L E C T   1   F R O M   p u b l i c . p r o f i l e s   W H E R E   p r o f i l e s . i d   =   a u t h . u i d ( )   A N D   p r o f i l e s . r o l e   I N   ( ' t r a f f i c _ o p e r a t o r ' ,   ' a d m i n ' ) )  
 ) ;  
 C R E A T E   P O L I C Y   " T r a f f i c   P o l i c e   c a n   i n s e r t   a s s i g n m e n t s "   O N   p u b l i c . p o l i c e _ a s s i g n m e n t s   F O R   I N S E R T   W I T H   C H E C K   (  
     E X I S T S   ( S E L E C T   1   F R O M   p u b l i c . p r o f i l e s   W H E R E   p r o f i l e s . i d   =   a u t h . u i d ( )   A N D   p r o f i l e s . r o l e   I N   ( ' t r a f f i c _ o p e r a t o r ' ,   ' a d m i n ' ) )  
 ) ;  
  
 - -   E m e r g e n c y   S t a t u s   L o g s :   P u b l i c   r e a d ,   a u t h e n t i c a t e d   u s e r s   c a n   i n s e r t  
 C R E A T E   P O L I C Y   " P u b l i c   c a n   v i e w   e m e r g e n c y   s t a t u s   l o g s "   O N   p u b l i c . e m e r g e n c y _ s t a t u s _ l o g s   F O R   S E L E C T   U S I N G   ( t r u e ) ;  
 C R E A T E   P O L I C Y   " A u t h e n t i c a t e d   u s e r s   c a n   i n s e r t   e m e r g e n c y   s t a t u s   l o g s "   O N   p u b l i c . e m e r g e n c y _ s t a t u s _ l o g s   F O R   I N S E R T   W I T H   C H E C K   ( a u t h . u i d ( )   I S   N O T   N U L L ) ;  
  
 - -   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =  
 - -   T R I G G E R S  
 - -   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =  
 C R E A T E   O R   R E P L A C E   F U N C T I O N   p u b l i c . u p d a t e _ u p d a t e d _ a t _ c o l u m n ( )  
 R E T U R N S   T R I G G E R   A S   $ $  
 B E G I N  
       N E W . u p d a t e d _ a t   =   N O W ( ) ;  
       R E T U R N   N E W ;  
 E N D ;  
 $ $   L A N G U A G E   p l p g s q l ;  
  
 - -   A p p l y   u p d a t e d _ a t   t r i g g e r s  
 D O   $ $   B E G I N   I F   N O T   E X I S T S   ( S E L E C T   1   F R O M   p g _ t r i g g e r   W H E R E   t g n a m e   =   ' u p d a t e _ h o s p i t a l s _ m o d t i m e ' )   T H E N   C R E A T E   T R I G G E R   u p d a t e _ h o s p i t a l s _ m o d t i m e   B E F O R E   U P D A T E   O N   p u b l i c . h o s p i t a l s   F O R   E A C H   R O W   E X E C U T E   P R O C E D U R E   p u b l i c . u p d a t e _ u p d a t e d _ a t _ c o l u m n ( ) ;   E N D   I F ;   E N D   $ $ ;  
 D O   $ $   B E G I N   I F   N O T   E X I S T S   ( S E L E C T   1   F R O M   p g _ t r i g g e r   W H E R E   t g n a m e   =   ' u p d a t e _ a m b u l a n c e s _ m o d t i m e ' )   T H E N   C R E A T E   T R I G G E R   u p d a t e _ a m b u l a n c e s _ m o d t i m e   B E F O R E   U P D A T E   O N   p u b l i c . a m b u l a n c e s   F O R   E A C H   R O W   E X E C U T E   P R O C E D U R E   p u b l i c . u p d a t e _ u p d a t e d _ a t _ c o l u m n ( ) ;   E N D   I F ;   E N D   $ $ ;  
 D O   $ $   B E G I N   I F   N O T   E X I S T S   ( S E L E C T   1   F R O M   p g _ t r i g g e r   W H E R E   t g n a m e   =   ' u p d a t e _ j u n c t i o n s _ m o d t i m e ' )   T H E N   C R E A T E   T R I G G E R   u p d a t e _ j u n c t i o n s _ m o d t i m e   B E F O R E   U P D A T E   O N   p u b l i c . j u n c t i o n s   F O R   E A C H   R O W   E X E C U T E   P R O C E D U R E   p u b l i c . u p d a t e _ u p d a t e d _ a t _ c o l u m n ( ) ;   E N D   I F ;   E N D   $ $ ;  
 D O   $ $   B E G I N   I F   N O T   E X I S T S   ( S E L E C T   1   F R O M   p g _ t r i g g e r   W H E R E   t g n a m e   =   ' u p d a t e _ t r a f f i c _ i n c i d e n t s _ m o d t i m e ' )   T H E N   C R E A T E   T R I G G E R   u p d a t e _ t r a f f i c _ i n c i d e n t s _ m o d t i m e   B E F O R E   U P D A T E   O N   p u b l i c . t r a f f i c _ i n c i d e n t s   F O R   E A C H   R O W   E X E C U T E   P R O C E D U R E   p u b l i c . u p d a t e _ u p d a t e d _ a t _ c o l u m n ( ) ;   E N D   I F ;   E N D   $ $ ;  
  
 - -   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =  
 - -   R E A L T I M E   P U B L I C A T I O N S  
 - -   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =  
 D O   $ $  
 B E G I N  
     - -   W e   a s s u m e   ' s u p a b a s e _ r e a l t i m e '   p u b l i c a t i o n   a l r e a d y   e x i s t s   f r o m   f u l l _ s e t u p . s q l  
     - -   A t t e m p t   t o   a d d   t a b l e s   t o   i t .  
     A L T E R   P U B L I C A T I O N   s u p a b a s e _ r e a l t i m e   A D D   T A B L E   p u b l i c . a m b u l a n c e s ;  
     A L T E R   P U B L I C A T I O N   s u p a b a s e _ r e a l t i m e   A D D   T A B L E   p u b l i c . j u n c t i o n s ;  
     A L T E R   P U B L I C A T I O N   s u p a b a s e _ r e a l t i m e   A D D   T A B L E   p u b l i c . t r a f f i c _ i n c i d e n t s ;  
     A L T E R   P U B L I C A T I O N   s u p a b a s e _ r e a l t i m e   A D D   T A B L E   p u b l i c . l o c a t i o n _ t e l e m e t r y ;  
     A L T E R   P U B L I C A T I O N   s u p a b a s e _ r e a l t i m e   A D D   T A B L E   p u b l i c . n o t i f i c a t i o n s ;  
     A L T E R   P U B L I C A T I O N   s u p a b a s e _ r e a l t i m e   A D D   T A B L E   p u b l i c . p o l i c e _ a s s i g n m e n t s ;  
 E X C E P T I O N   W H E N   O T H E R S   T H E N  
     R A I S E   N O T I C E   ' E r r o r   a d d i n g   t a b l e s   t o   s u p a b a s e _ r e a l t i m e . ' ;  
 E N D ;  
 $ $ ;  
 