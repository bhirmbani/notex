CREATE TABLE `graph_node_explanations` (
	`id` text PRIMARY KEY NOT NULL,
	`context_id` text NOT NULL,
	`graph_hash` text NOT NULL,
	`node_id` text NOT NULL,
	`explanation` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`context_id`) REFERENCES `contexts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `graph_node_explanations_context_graph_hash_node_unique` ON `graph_node_explanations` (`context_id`,`graph_hash`,`node_id`);--> statement-breakpoint
CREATE INDEX `graph_node_explanations_context_graph_hash_idx` ON `graph_node_explanations` (`context_id`,`graph_hash`);