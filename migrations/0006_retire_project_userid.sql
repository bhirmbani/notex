-- Every User gets a personal Organization (role: admin) auto-created on
-- signup, but organization_id was only ever set going forward from when the
-- column was added — projects created via the earlier userId-only
-- `POST /projects` endpoint were never backfilled. Assign each such project
-- to its creator's oldest admin Membership's Organization before the column
-- becomes NOT NULL below, so the rebuild doesn't fail on legacy rows.
UPDATE `projects`
SET `organization_id` = (
	SELECT `m`.`organization_id`
	FROM `memberships` AS `m`
	WHERE `m`.`user_id` = `projects`.`user_id` AND `m`.`role` = 'admin'
	ORDER BY `m`.`created_at` ASC
	LIMIT 1
)
WHERE `organization_id` IS NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_projects`("id", "organization_id", "name", "description", "created_at") SELECT "id", "organization_id", "name", "description", "created_at" FROM `projects`;--> statement-breakpoint
DROP TABLE `projects`;--> statement-breakpoint
ALTER TABLE `__new_projects` RENAME TO `projects`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `projects_organization_id_idx` ON `projects` (`organization_id`);