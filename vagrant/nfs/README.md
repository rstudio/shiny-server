

Spin up the NFS server first:

```
vagrant up nfs
```

Then you can bring up the Shiny Server machine:

```
vagrant up sso
```

At this point, you should have a Shiny Server instance which mounts the directory `/home/shiny` over NFS with `root_squash` which can be used to test user_dirs over NFS with root_squash.
