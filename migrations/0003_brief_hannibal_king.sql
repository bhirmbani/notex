ALTER TABLE `projects` ADD `organization_id` text REFERENCES organizations(id);--> statement-breakpoint
CREATE INDEX `projects_organization_id_idx` ON `projects` (`organization_id`);