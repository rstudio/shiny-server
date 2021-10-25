#!/usr/bin/env bash

if [ $# -eq 0 ]; then
    echo "publish-build.sh: utility for adding builds to the latest builds site."
    echo ""
    echo "Creates, commits, and pushes a Markdown file containing the specified build metadata."
    echo ""
    echo "Arguments:"
    echo ""
    echo "--platform  The Linux platform. Example: centos7"
    echo ""
    echo "--url       A URL to a location where the build can be downloaded. Example:"
    echo "            https://s3.amazonaws.com/rstudio-shiny-server-os-build/ubuntu-14.04/x86_64/shiny-server-1.5.18.974-amd64.deb"
    echo ""
    echo "--file      A path to a local copy of the build file. Example:"
    echo "            /tmp/shiny-server-1.5.18.974-amd64.deb"
    echo ""
    echo "--pat       The Github Personal Access Token (PAT) to be used to authorize the commit."
    echo "            May be specified in the environment variable GITHUB_PAT instead."
    exit 0
fi

# abort on error
set -e

# List of arguments
ARGUMENT_LIST=(
    "platform"
    "url"
    "file"
    "pat"
)

# Parse arguments with getopt
opts=$(getopt \
    --longoptions "$(printf "%s:," "${ARGUMENT_LIST[@]}")" \
    --name "$(basename "$0")" \
    --options "" \
    -- "$@"
)

# Apply to variables
while [[ $# -gt 0 ]]; do
    case "$1" in
        --platform)
            platform=$2
            shift 2
            ;;

        --url)
            url=$2
            shift 2
            ;;

        --file)
            file=$2
            shift 2
            ;;

        --pat)
            pat=$2
            shift 2
            ;;

        *)
            break
            ;;
    esac
done

if [ -z "$platform" ]; then
    echo "Platform not set; specify a platform with --platform. Example: --platform redhat8"
    exit 1
fi

if [ -z "$url" ]; then
    echo "URL not set; specify a build with --url. Example: --url https:/s3.amazonaws.com/rstudio-ide-build/desktop/windows/RStudio-pro.exe"
    exit 1
fi

if [ -z "$file" ]; then
    echo "File not set; specify a file with --file. Example: --file /tmp/RStudio-pro.exe"
    exit 1
fi

if [ -z "$pat" ]; then
    if [ -z "$GITHUB_PAT" ]; then
        echo "Github Personal Access Token (PAT) not set; specify a PAT with --pat or the GITHUB_PAT environment variable."
        exit 1
    else
        # PAT supplied in environment variable; promote to local
        pat="$GITHUB_PAT"
    fi
fi

# Determine file size
size=$(wc -c $file | awk '{print $1}')

# Determine file SHA256 sum
if [[ "$OSTYPE" == "darwin"* ]]; then
  sha256=$(shasum -a 256 $file | awk '{print $1}')
else
  sha256=$(sha256sum $file | awk '{print $1}')
fi

# Form ISO 8601 timestamp
timestamp=$(date +"%Y-%m-%dT%H:%M:%S%z")

# Extract packaging version
root="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && cd ../.. && pwd )"
version="$(cat "$root/packaging/build/VERSION")"

# Determine which product is being built by checking for the overlay make script
if [[ -f "$root/CMakeOverlay.txt" ]]; then
  product="professional"
else
  product="open-source"
fi

# Determine commit (use local hash)
pushd $root
commit=$(git rev-parse HEAD)
popd

# Escape + characters in URL (for versioning)
url=$(echo $url | sed -e 's/+/%2B/g')

# Create version stem. This is a very file-safe version of the version: first
# we replace non-alphanumerics with dashes, then collapse multiple dashes to a
# single dash.
version_stem=$(echo $version | sed -e 's/[^a-zA-Z0-9-]/-/g' | sed -e 's/--*/-/g')

# Create "branch" name. For Shiny Server this is the major and minor release
# version, so parse the full version number to extract the first two
# components.
old_ifs="$IFS"
IFS='.' read -ra components <<< "$version"
IFS="$old_ifs"
branch="${components[0]}.${components[1]}"

filename=$(basename $file)

md_contents="---
type: build
date: $timestamp
link: \"$url\"
filename: \"$filename\"
sha256: \"$sha256\"
channel: Daily
version: \"$version\"
commit: \"$commit\"
size: $size
---
"

echo "Creating $branch/$product/$platform/$version_stem.md..."
echo "$md_contents"
if [[ "$OSTYPE" == "darwin"* ]]; then
  base64_contents=$(echo "$md_contents" | base64 --break=0)
else
  base64_contents=$(echo "$md_contents" | base64 --wrap=0)
fi

payload="{\"message\":\"Add Shiny Server $product build $version for $platform\",\"content\":\"$base64_contents\"}"
echo "Sending to Github: $payload"

curl \
  -X PUT \
  -H "Accept: application/vnd.github.v3+json" \
  -H "Authorization: token $pat" \
  "https://api.github.com/repos/rstudio/latest-builds/contents/content/shiny-server/$branch/$product/$platform/$version_stem.md" \
  -d "$payload"

