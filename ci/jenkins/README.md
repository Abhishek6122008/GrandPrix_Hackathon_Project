# Jenkins

```bash
docker compose up -d --build      # from this directory
```

Then <http://localhost:8081>. Unlock key:

```bash
docker compose exec jenkins cat /var/jenkins_home/secrets/initialAdminPassword
```

New Item → **Pipeline** → Pipeline script from SCM → Git → this repo, script path `Jenkinsfile`.

Full explanation — what the pipeline does, why the toolchains are baked into this image, and
why the setup wizard is deliberately left on — is in [`docs/ci-cd.md`](../../docs/ci-cd.md).

| | |
|---|---|
| `Dockerfile` | Jenkins LTS + JDK 21, Maven, Node 22, Python 3.11, Docker CLI |
| `docker-compose.yml` | Runs it on 8081, with `jenkins_home` on a named volume |
| `plugins.txt` | Baked in, so a rebuild comes back with the same plugins |

State lives in the `jenkins_home` volume. `docker compose down` keeps it; `down -v` deletes
every job and credential with it.
