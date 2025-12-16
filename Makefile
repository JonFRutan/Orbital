.PHONY: update update-code build-frontend
update: update-code build-frontend
update-code:
	@echo "Pulling from git repo"
	git pull
build-frontend:
	npm run build