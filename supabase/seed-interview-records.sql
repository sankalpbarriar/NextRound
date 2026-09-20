-- Seed the historical interview sheet records.
-- Run after schema.sql. Safe to run more than once.

insert into public.scheduled_interviews (
  candidate_name,
  interviewer_details,
  candidate_email,
  candidate_phone,
  interview_date,
  interview_time,
  google_meet_link,
  scheduled_by,
  status,
  details
)
select seed.candidate_name,
       seed.interviewer_details,
       '',
       seed.candidate_phone,
       seed.interview_date::date,
       '',
       '',
       'Imported from interview records sheet',
       'Done',
       'Imported historical interview record'
from (values
  ('Ramansh Yadav', 'Avinash & Sankalp', '6266759398', '2026-06-20'),
  ('Sujud Khan', 'Did not Attended', '9302745744', '2026-07-19'),
  ('Pranjal Srivastava', 'Avinash & Sankalp', '9977676444', '2026-07-23'),
  ('Ritul jain', 'Avinash & Sankalp', '9993448916', '2026-07-26'),
  ('Kaushik Vishwakarma', 'Avinash & Shashank', '8819066462', '2026-08-09'),
  ('Ramansh Yadav', 'Ayush', '6266759398', '2026-08-09'),
  ('Shreshthi singh rajput', 'Ayush, Sankalp', '9302594534', '2026-08-14'),
  ('Sourabh Patel', 'Avinash, Sashank', '9302950827', '2026-08-21'),
  ('Om Patel', 'Avinash, Sankalp', '7489874168', '2026-08-23'),
  ('Nishtha Raut', 'Avinash', '8815743636', '2026-08-25'),
  ('Sourabh Patel', 'Ayush, Sankalp', '9302950827', '2026-08-30'),
  ('Mahak Rajput', 'Sankalp, Sashank', '9926552238', '2026-08-31'),
  ('Ajay Singh thakur', 'Avinash, Ayush', '6261769126', '2026-09-01'),
  ('Namrata Digarse', 'Avinash, Sankalp', '9755850887', '2026-09-02'),
  ('Shreshthi singh Rajput', 'Avinash', '9302594534', '2026-09-05'),
  ('Ajay Singh Thakur', 'Sankalp', '6261769126', '2026-09-06'),
  ('Sourabh Patel', 'Sashank', '9302950827', '2026-09-05'),
  ('Om Patel', 'Ayush', '7489874168', '2026-09-06'),
  ('DivyaPrakash Dwivedi', 'Avinash, Ayush', '7049471964', '2026-09-07'),
  ('Ishan Rai', 'Avinash', '8827890816', '2026-09-06'),
  ('Mahak Rajput', 'Avinash', '9926552238', '2026-09-06'),
  ('Divya Prakash Dwivedi', 'Avinash', '7049471964', '2026-09-07'),
  ('Kaushik Vishwakarma', 'Avinash', '8819066462', '2026-09-13'),
  ('Abhinav Jain', 'Avinash', '9340414284', '2026-09-14'),
  ('Harsh Thakur', 'Sankalp', '8770558500', '2026-09-15'),
  ('Om Patel', 'Ayush', '7489874168', '2026-09-16'),
  ('Shreya Pathak', 'Avinash', '9303558677', '2026-09-19'),
  ('Aarya Gupta', 'Sankalp, Avinash', '8770899674', '2026-09-20')
) as seed(candidate_name, interviewer_details, candidate_phone, interview_date)
where not exists (
  select 1
  from public.scheduled_interviews existing
  where lower(existing.candidate_name) = lower(seed.candidate_name)
    and existing.interview_date = seed.interview_date::date
    and lower(existing.interviewer_details) = lower(seed.interviewer_details)
);
