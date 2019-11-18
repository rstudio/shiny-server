{
  "targets": [
    {
      "target_name": "posix",
      "sources": [ "src/posix.cc" ],
      "include_dirs" : [
        "<!(node -e \"require('nan')\")"
      ]
    }
  ]
}
