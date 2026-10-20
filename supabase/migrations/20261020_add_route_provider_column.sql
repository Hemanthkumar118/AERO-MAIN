-- Migration: Add route_provider column to emergency_incidents and reload PostgREST schema cache
-- Run this in the Supabase SQL Editor: https://supabase.com/dashboard/project/mfsmlyiwhejmwhpgemns/sql/new

ALTER TABLE public.emergency_incidents
ADD COLUMN IF NOT EXISTS route_provider TEXT;

-- Notify PostgREST to reload the schema cache immediately
NOTIFY pgrst, 'reload schema';
