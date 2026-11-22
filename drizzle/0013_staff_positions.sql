UPDATE moderators SET position=CASE position WHEN 'Стажер' THEN 'Джуниор' WHEN 'Мл. Сотрудник' THEN 'Шериф' WHEN 'Сотрудник' THEN 'Саппорт' WHEN 'Ст. Сотрудник' THEN 'Спектатор' WHEN 'Вед. Сотрудник' THEN 'Спектатор' WHEN 'Куратор' THEN 'Менеджер' ELSE position END;
--> statement-breakpoint
UPDATE former_moderators SET position=CASE position WHEN 'Стажер' THEN 'Джуниор' WHEN 'Мл. Сотрудник' THEN 'Шериф' WHEN 'Сотрудник' THEN 'Саппорт' WHEN 'Ст. Сотрудник' THEN 'Спектатор' WHEN 'Вед. Сотрудник' THEN 'Спектатор' WHEN 'Куратор' THEN 'Менеджер' ELSE position END;
--> statement-breakpoint
UPDATE manuals SET allowed_positions=(SELECT json_group_array(p) FROM (SELECT DISTINCT CASE value WHEN 'Стажер' THEN 'Джуниор' WHEN 'Мл. Сотрудник' THEN 'Шериф' WHEN 'Сотрудник' THEN 'Саппорт' WHEN 'Ст. Сотрудник' THEN 'Спектатор' WHEN 'Вед. Сотрудник' THEN 'Спектатор' WHEN 'Куратор' THEN 'Менеджер' ELSE value END AS p FROM json_each(manuals.allowed_positions)))
WHERE allowed_positions IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER moderators_owner_insert BEFORE INSERT ON moderators
WHEN NEW.position='Владелец' AND (SELECT COUNT(*) FROM moderators WHERE position='Владелец')>=2
BEGIN SELECT RAISE(ABORT,'OWNER_LIMIT'); END;
--> statement-breakpoint
CREATE TRIGGER moderators_owner_update BEFORE UPDATE OF position ON moderators
WHEN NEW.position='Владелец' AND OLD.position<>'Владелец' AND (SELECT COUNT(*) FROM moderators WHERE position='Владелец')>=2
BEGIN SELECT RAISE(ABORT,'OWNER_LIMIT'); END;
