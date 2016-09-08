Docker containers for Shiny Server development
==============================================

The `ubuntu16.04/` directory contains a Dockerfile for creating an Docker image that can be used for Shiny Server development.

**Note:** Any files created will have UID 1000. This UID is generally the same as the first user added on most Linux hosts, but not for macOS hosts. This may cause problems with creating or modifying any files. Hopefully, Docker will provide a good solution for this in the future.


## Building the image

To build the Docker image, start in the shiny-server directory and run:

```sh
docker build -t ss-devel docker/ubuntu16.04/
```

## Running the image

```sh
docker run --rm -ti -p 3838:3838 -v $(pwd):/shiny-server --name ssd ss-devel
```

This will start a shell as the `docker` user. This user can `sudo` without a password.

Shiny Server has already been installed in the image, so various system files, directories, and the `shiny` user will already exist.

Once started, you will need to build Shiny Server once:

```sh
cd /shiny-server
cd packaging
./make-package.sh
```

Once this is done, you can start `shiny-server` directly from the development directory. You can also modify the source code and restart `shiny-server`.

```sh
cd /shiny-server
sudo bin/shiny-server
```

After all this is done, you may want to rebuild the package and reinstall:

```sh
cd packaging
./make-package.sh

# Might need to adjust the version
sudo dpkg -i build/shiny-server-1.4.4.0-amd64.deb
```


## Notes

If you want to mount the shiny source at `/shiny` and be able to install it, start the container with `-v $(pwd)/../shiny:/shiny` (assuming it's a sibling directory of `shiny-server/`):

```sh
# Start in shiny-server directory
docker run --rm -ti -p 3838:3838 \
    -v $(pwd):/shiny-server \
    -v $(pwd)/../shiny:/shiny \
    --name ssd ss-devel

# Then, in another terminal, you can install Shiny:
docker exec -ti ssd Rscript -e 'devtools::install("/shiny")'
```


If you need to enter a running container and inspect it or install software on it, run:

```
docker exec -ti ssd /bin/bash
```


If you want to rebuild the docker image without any cached layers, you can delete the `ss-devel` image and rebuild, or you can build with the `--no-cache` flag. The image can be deleted with:

```sh
# Remove the image and rebuild
docker rmi ss-devel
docker build -t ss-devel docker/ubuntu16.04/

# Or build with no cache
docker build --no-cache -t ss-devel docker/ubuntu16.04/
```
