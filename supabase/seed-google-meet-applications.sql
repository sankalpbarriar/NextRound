-- Add application records received from Google Meet.
-- Run after schema.sql. Safe to run more than once.

insert into public.applications (
  name,
  email,
  whatsapp,
  college,
  semester,
  branch,
  technology,
  languages,
  preferred_date,
  interview_format,
  notes,
  payment_proof_url,
  source
)
select
  'Dhruv Mishra',
  'dhruvm1305@gmail.com',
  '7225007674',
  null,
  '7th sem',
  'CSE',
  'Java',
  'Spring, React',
  '2026-09-22'::date,
  'One-on-One Interview (1 candidate + 1 interviewer)',
  'Record received from Google Meet. Original row timestamp: 2026-09-22 11:15:45.',
  'https://drive.google.com/open?id=15CF_AvyqCPQQ5x6dl71tYPNVW4aVYRgi',
  'Google Meet'
where not exists (
  select 1
  from public.applications existing
  where lower(existing.email) = lower('dhruvm1305@gmail.com')
    and existing.preferred_date = '2026-09-22'::date
    and existing.source = 'Google Meet'
);
