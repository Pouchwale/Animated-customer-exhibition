-- Reviews removed from the app: the customer reviews, their "Rate your pouch" feedback parameters and the
-- product they belonged to. (A JSON export taken before this ran is in server/backups.)
DROP TABLE "ReviewRating";
DROP TABLE "Review";
DROP TABLE "ReviewCriterion";
DROP TABLE "Product";
