#!groovy

properties([
    disableConcurrentBuilds(),
    buildDiscarder(logRotator(artifactDaysToKeepStr: '',
                              artifactNumToKeepStr: '',
                              daysToKeepStr: '',
                              numToKeepStr: '100')),
    parameters([string(name: 'SLACK_CHANNEL', defaultValue: '#shiny-server', description: 'Slack channel to publish build message.')])
])

def prepareWorkspace(){ // accessory to clean workspace and checkout
  step([$class: 'WsCleanup'])
  checkout scm
  sh 'git reset --hard && git clean -ffdx' // lifted from rstudio/connect
}

try {
    timestamps {
        def containers = [
          [os: 'ubuntu-12.04', arch: 'x86_64'],
          [os: 'centos5.9', arch: 'x86_64'],
          [os: 'centos6.3', arch: 'x86_64']
        ]
        def parallel_containers = [:]
        for (int i = 0; i < containers.size(); i++) {
            def index = i
            parallel_containers["${containers[i].os}-${containers[i].arch}"] = {
                def current_container = containers[index]
                node('docker') {
                    stage('prepare ws/container'){
                      prepareWorkspace()
                      def image_tag = "${current_container.os}-${current_container.arch}"
                      container = pullBuildPush(image_name: 'jenkins/shiny-server', dockerfile: "docker/jenkins/Dockerfile.${current_container.os}", image_tag: image_tag, build_arg_jenkins_uid: 'JENKINS_UID', build_arg_jenkins_gid: 'JENKINS_GID')
                    }
                    container.inside() {
                        withEnv(["OS=${current_container.os}", "ARCH=${current_container.arch}"]) {
                          stage('make package'){
                              sh """
                              if [ -f ./packaging/make-package-jenkins.sh ]; then
                                ./packaging/make-package-jenkins.sh
                                else
                                ./packaging/make-package.sh
                              fi
                              """
                          }
                          stage('run tests') {
                              sh './bin/node ./node_modules/mocha/bin/mocha test'
                          }
                          stage('check licenses') {
                              sh 'tools/preflight.sh'
                          }
                        }
                    }
                    //stage('s3 upload') {
                    //    TODO
                    //}
                }
            }
        }
        parallel parallel_containers

        sendNotifications slack_channel: SLACK_CHANNEL
    }

} catch(err) {
   sendNotifications slack_channel: SLACK_CHANNEL
   error("failed: ${err}")
}
