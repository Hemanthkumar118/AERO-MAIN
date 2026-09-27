-- ============================================================
-- AERO Migration: RPC for retrieving or creating a hospital
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_or_create_hospital(
    p_name TEXT,
    p_address TEXT,
    p_lat DOUBLE PRECISION,
    p_lng DOUBLE PRECISION,
    p_phone TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_id UUID;
BEGIN
    -- Try to find by exact name (or approximate location)
    SELECT id INTO v_id FROM public.hospitals WHERE name = p_name LIMIT 1;
    
    IF v_id IS NULL THEN
        INSERT INTO public.hospitals (name, address, location, phone, emergency_capable)
        VALUES (
            p_name, 
            p_address, 
            ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326), 
            p_phone, 
            true
        )
        RETURNING id INTO v_id;
    END IF;

    RETURN v_id;
END;
$$;
