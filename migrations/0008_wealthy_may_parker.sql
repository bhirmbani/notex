CREATE TABLE `graph_generations` (
	`id` text PRIMARY KEY NOT NULL,
	`context_id` text NOT NULL,
	`graph_hash` text NOT NULL,
	`built_at` text NOT NULL,
	`head_sha` text,
	`node_count` integer NOT NULL,
	`edge_count` integer NOT NULL,
	`community_count` integer NOT NULL,
	`question_at_generation` text NOT NULL,
	`subgraph` text NOT NULL,
	`context` text,
	`footer` text,
	`low_confidence_top_score` real,
	`draft_text` text DEFAULT '' NOT NULL,
	`draft_name` text DEFAULT 'Graph draft' NOT NULL,
	`expansion_banner` text,
	`synthesis_banner` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`context_id`) REFERENCES `contexts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `graph_generations_context_graph_hash_unique` ON `graph_generations` (`context_id`,`graph_hash`);--> statement-breakpoint
CREATE INDEX `graph_generations_context_id_idx` ON `graph_generations` (`context_id`);