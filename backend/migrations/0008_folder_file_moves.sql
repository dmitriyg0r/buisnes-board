-- При переносе дерева папок файлы и папки меняют базу в одной транзакции.
ALTER TABLE files ALTER CONSTRAINT files_folder_workspace_fk DEFERRABLE INITIALLY IMMEDIATE;
