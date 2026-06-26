-- Güvenli temizlik: aynı action_plan_id'ye sahip duplikate VAP kayıtlarından en eskisi (min id) hariç silinir
DELETE FROM "vap_projects"
WHERE id NOT IN (
  SELECT MIN(id) FROM "vap_projects" GROUP BY action_plan_id
);
--> statement-breakpoint

-- vap_projects.action_plan_id üzerine UNIQUE kısıt ekle
ALTER TABLE "vap_projects"
ADD CONSTRAINT "vap_projects_action_plan_id_unique" UNIQUE ("action_plan_id");
