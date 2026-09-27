-- Seed script for Hospitals
INSERT INTO public.hospitals (id, name, address, location, phone, emergency_capable, total_beds, available_icu_beds, trauma_bays_available)
VALUES
(uuid_generate_v4(), 'Apollo Main Hospital', 'Greams Road, Chennai', ST_SetSRID(ST_MakePoint(80.2541, 13.0617), 4326), '+91-44-28293333', true, 500, 50, 10),
(uuid_generate_v4(), 'Fortis Hospital', 'Bannerghatta Road, Bangalore', ST_SetSRID(ST_MakePoint(77.5946, 12.8942), 4326), '+91-80-66214444', true, 400, 45, 8),
(uuid_generate_v4(), 'Manipal Hospital', 'Old Airport Road, Bangalore', ST_SetSRID(ST_MakePoint(77.6413, 12.9592), 4326), '+91-80-25024444', true, 600, 60, 12),
(uuid_generate_v4(), 'AIIMS', 'Ansari Nagar, New Delhi', ST_SetSRID(ST_MakePoint(77.2090, 28.5659), 4326), '+91-11-26588500', true, 2000, 200, 30),
(uuid_generate_v4(), 'Lilavati Hospital', 'Bandra West, Mumbai', ST_SetSRID(ST_MakePoint(72.8273, 19.0505), 4326), '+91-22-26751000', true, 314, 30, 5),
(uuid_generate_v4(), 'Christian Medical College (CMC)', 'Vellore, Tamil Nadu', ST_SetSRID(ST_MakePoint(79.1350, 12.9288), 4326), '+91-416-2281000', true, 2500, 150, 20),
(uuid_generate_v4(), 'Medanta - The Medicity', 'Sector 38, Gurugram', ST_SetSRID(ST_MakePoint(77.0396, 28.4310), 4326), '+91-124-4141414', true, 1250, 100, 15),
(uuid_generate_v4(), 'Kokilaben Dhirubhai Ambani Hospital', 'Andheri West, Mumbai', ST_SetSRID(ST_MakePoint(72.8286, 19.1302), 4326), '+91-22-30999999', true, 750, 80, 10),
(uuid_generate_v4(), 'Rajagiri Hospital', 'Aluva, Kochi', ST_SetSRID(ST_MakePoint(76.3533, 10.0952), 4326), '+91-484-2905000', true, 500, 40, 8),
(uuid_generate_v4(), 'Narayana Health City', 'Bommasandra, Bangalore', ST_SetSRID(ST_MakePoint(77.6830, 12.8122), 4326), '+91-80-71222222', true, 1000, 100, 12),
(uuid_generate_v4(), 'Max Super Speciality Hospital', 'Saket, New Delhi', ST_SetSRID(ST_MakePoint(77.2088, 28.5273), 4326), '+91-11-26515050', true, 500, 50, 6)
ON CONFLICT (id) DO NOTHING;
