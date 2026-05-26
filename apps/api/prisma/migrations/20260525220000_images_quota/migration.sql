-- Monthly quota is tracked in images, not import jobs.
ALTER TABLE "usage_counters" RENAME COLUMN "jobs_used" TO "images_used";
