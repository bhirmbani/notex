CREATE TABLE `grants` (
	`id` text PRIMARY KEY NOT NULL,
	`membership_id` text NOT NULL,
	`project_id` text NOT NULL,
	`level` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `grants_membership_project_unique` ON `grants` (`membership_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `grants_project_id_idx` ON `grants` (`project_id`);