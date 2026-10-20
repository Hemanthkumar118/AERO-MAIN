-- ============================================================
-- AERO Clinical Observations Table Migration
-- Associates authentic paramedic assessments & vitals with emergency incidents
-- ============================================================

-- 1. Create clinical_observations table
CREATE TABLE IF NOT EXISTS public.clinical_observations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  incident_id UUID NOT NULL REFERENCES public.emergency_incidents(id) ON DELETE CASCADE,
  recorded_by UUID REFERENCES auth.users(id),
  recorded_by_name TEXT,
  recorded_by_role TEXT NOT NULL DEFAULT 'ambulance',
  ambulance_id TEXT,
  hospital_id TEXT,
  hospital_name TEXT,
  
  -- Clinical Telemetry Vitals
  heart_rate INTEGER CHECK (heart_rate IS NULL OR (heart_rate >= 20 AND heart_rate <= 300)),
  systolic_bp INTEGER CHECK (systolic_bp IS NULL OR (systolic_bp >= 40 AND systolic_bp <= 300)),
  diastolic_bp INTEGER CHECK (diastolic_bp IS NULL OR (diastolic_bp >= 20 AND diastolic_bp <= 200)),
  spo2 INTEGER CHECK (spo2 IS NULL OR (spo2 >= 50 AND spo2 <= 100)),
  respiratory_rate INTEGER CHECK (respiratory_rate IS NULL OR (respiratory_rate >= 4 AND respiratory_rate <= 80)),
  gcs INTEGER CHECK (gcs IS NULL OR (gcs >= 3 AND gcs <= 15)),
  temperature DOUBLE PRECISION CHECK (temperature IS NULL OR (temperature >= 30.0 AND temperature <= 45.0)),
  
  -- Patient Assessment & Category
  emergency_category TEXT NOT NULL CHECK (emergency_category IN ('TRAUMA', 'CARDIAC', 'RESPIRATORY', 'STROKE', 'SEPSIS', 'PEDIATRIC', 'BURNS', 'GENERAL_MEDICAL', 'OTHER')),
  triage_severity TEXT NOT NULL DEFAULT 'CRITICAL' CHECK (triage_severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
  chief_complaint TEXT,
  clinical_notes TEXT,
  is_manual BOOLEAN NOT NULL DEFAULT true,
  source_device TEXT DEFAULT 'MANUAL_PARAMEDIC_ENTRY',
  
  -- Timestamps
  recorded_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_clinical_observations_incident_id ON public.clinical_observations(incident_id);
CREATE INDEX IF NOT EXISTS idx_clinical_observations_recorded_at ON public.clinical_observations(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_clinical_observations_hospital_name ON public.clinical_observations(hospital_name);

-- 3. Enable RLS
ALTER TABLE public.clinical_observations ENABLE ROW LEVEL SECURITY;

-- 4. Idempotent RLS Policies
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can view clinical observations' AND tablename = 'clinical_observations') THEN
    CREATE POLICY "Authenticated users can view clinical observations" 
    ON public.clinical_observations FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authorized crew can insert clinical observations' AND tablename = 'clinical_observations') THEN
    CREATE POLICY "Authorized crew can insert clinical observations" 
    ON public.clinical_observations FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authorized crew can update clinical observations' AND tablename = 'clinical_observations') THEN
    CREATE POLICY "Authorized crew can update clinical observations" 
    ON public.clinical_observations FOR UPDATE TO authenticated USING (true);
  END IF;
END $$;

-- 5. Updated_at trigger
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_clinical_observations_modtime') THEN
    CREATE TRIGGER update_clinical_observations_modtime
    BEFORE UPDATE ON public.clinical_observations
    FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column();
  END IF;
END $$;

-- 6. Add to Supabase Realtime publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND schemaname = 'public' 
    AND tablename = 'clinical_observations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.clinical_observations;
  END IF;
END $$;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
