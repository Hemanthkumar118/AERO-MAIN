-- 1. Add hospital_status to emergency_incidents
ALTER TABLE public.emergency_incidents 
ADD COLUMN IF NOT EXISTS hospital_status TEXT DEFAULT 'PENDING' CHECK (hospital_status IN ('PENDING', 'ACCEPTED', 'READY'));

-- 2. Notify pgrst to reload the schema cache so the API picks up the new column
NOTIFY pgrst, 'reload schema';
