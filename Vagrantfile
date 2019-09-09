#!/usr/bin/env ruby

# -*- mode: ruby -*-
# vi: set ft=ruby :

# Vagrantfile API/syntax version. Don't touch unless you know what you're doing!
VAGRANTFILE_API_VERSION = '2'

# If SSOS_VERSION is defined, that is used. Otherwise, we use whatever
# release is encoded here.
PreviousSSOSRelease = '1.5.9.923'
class SSOSVersion
  def to_s
    # If we want to enforce version, this is the place to do it. By acquiring
    # the version during this #to_s method, we avoid having it happen when
    # Vagrant is constructing its config (which happens across all instances
    # all the time).
    #
    # Basically, this #to_s function only gets called when the SSOSVersion
    # object needs to be used.
    #
    # Solution from:
    # https://github.com/hashicorp/vagrant/issues/2662#issuecomment-328838768
    version = ENV['SSOS_VERSION'] || ''
    version.empty? ? PreviousSSOSRelease : version
  end
end

# provision_ssos configures a vagrant instance with the specified IP and
# runs the provided provisioning scripts. Each of the scripts is passed the env.
def provision_ssos(instance, ip, env, scripts)
  instance.vm.network 'private_network', ip: ip

  scripts.each do |script|
    instance.vm.provision :shell,
                          :path => script,
                          :env => env
  end

  license_file = ENV['SSOS_LICENSE_FILE']
  if license_file
    # File copies are not privileged (root), so we copy to /tmp and then copy
    # into the SSOS install hierarchy within activate-license.sh.
    instance.vm.provision :file,
                          source: license_file,
                          destination: "/tmp/rstudio-ssos.lic"
  end
end

Boxes = {
  'ubuntu16' => 'bento/ubuntu-16.04',
  'ubuntu18' => 'bento/ubuntu-18.04',
  'centos6' => 'bento/centos-6.10',
  'centos7' => 'bento/centos-7.6',
  'fedora28' => 'bento/fedora-28',
  'opensuse42' => 'opensuse/openSUSE-42.3-x86_64',
  'opensuse15' => 'opensuse/openSUSE-15.0-x86_64',
}

Installers = {
  'plain' => {
    'ubuntu16' => 'vagrant/install-debian-plain.sh',
    'ubuntu18' => 'vagrant/install-debian-plain.sh',
    'centos6' => 'vagrant/install-centos-plain.sh',
    'centos7' => ['vagrant/install-centos-plain.sh', 'vagrant/install-centos7-plain.sh'],
    'fedora28' => ['vagrant/install-centos-plain.sh', 'vagrant/install-centos7-plain.sh'],
    'opensuse42' => 'vagrant/install-opensuse-plain.sh',
    'opensuse15' => 'vagrant/install-opensuse-plain.sh',
  },
  'latest' => {
    'ubuntu16' => 'vagrant/testing/install-ssos-ubuntu.sh',
    'ubuntu18' => 'vagrant/testing/install-ssos-ubuntu.sh',
    'centos6' => 'vagrant/testing/install-ssos-centos.sh',
    'centos7' => 'vagrant/testing/install-ssos-centos.sh',
    'fedora28' => 'vagrant/testing/install-ssos-fedora.sh',
    'opensuse42' => 'vagrant/testing/install-ssos-suse.sh',
    'opensuse15' => 'vagrant/testing/install-ssos-suse.sh',
  },
  'oldr' => {
    'ubuntu16' => 'vagrant/install-debian-oldr.sh',
    'centos7' => 'vagrant/install-centos7-oldr.sh',
    'opensuse42' => 'vagrant/install-opensuse-oldr.sh',
    'opensuse15' => 'vagrant/install-opensuse-oldr.sh',
  },
}

OSOctet = {
  'ubuntu16' => 51,
  'ubuntu18' => 52,
  'centos6' => 55,
  'centos7' => 56,
  'fedora28' => 58,
  'opensuse42' => 60,
  'opensuse15' => 61,
#  'license' => 70,
  'ssos' => 42,
}

SchemeOctet = {
  'docker' => 38,
  'plain' => 50,
  'oldr' => 74,
}

def build_instance_ip(distribution, flavor, auth)
  if flavor == "docker"
    distribution = "rsc"
    auth = flavor
  end
  if flavor == "oldr"
    auth = flavor
  end
  os_octet = OSOctet[distribution]
  scheme_octet = SchemeOctet[auth]
  return "192.168.#{os_octet}.#{scheme_octet}"
end

def build_instance_name(distribution, flavor, auth, separator)
  name = distribution
  if flavor != ""
    name = "#{name}#{separator}#{flavor}"
  end
  if auth != ""
    name = "#{name}#{separator}#{auth}"
  end
  return name
end

def setup_ssos_triggers(instance)
  # attempt to activate ssos license from key contained in environment
  # variable SSOS_LICENSE
  #instance.trigger.after [:up, :provision, :reload, :resume] do |trigger|
  #  trigger.info = 'Activating RStudio SSOS license...'
  #  trigger.run_remote = {
  #    :path => 'vagrant/testing/activate-license.sh',
  #    :args => [ ENV['SSOS_LICENSE'] || '' ],
  #  }
  #end

  # restart ssos after license activation above
  #instance.trigger.after [:up, :provision, :reload, :resume] do |trigger|
  #  trigger.info = 'Restarting RStudio SSOS...'
  #  trigger.run_remote = {path: 'vagrant/testing/restart-ssos.sh'}
  #end

  #instance.trigger.before [:suspend, :reload, :halt, :destroy] do |trigger|
  #  trigger.on_error = :continue
  #  trigger.info = 'Deactivating RStudio SSOS license...'
  #  trigger.run_remote = {path: 'vagrant/testing/deactivate-license.sh'}
  #end
end

def setup_license_triggers(instance)
  # attempt to activate ssos floating license from key contained in
  # environment variable SSOS_FLOATING_LICENSE
  #instance.trigger.after [:up, :provision, :reload, :resume] do |trigger|
  #  trigger.info = 'Activating license with the license server...'
  #  trigger.run_remote = {
  #    :path => 'vagrant/testing/activate-license-server.sh',
  #    :args => [ ENV['SSOS_FLOATING_LICENSE'] || '' ],
  #  }
  #end

  # restart license server after license activation above
  #instance.trigger.after [:up, :provision, :reload, :resume] do |trigger|
  #  trigger.info = 'Restarting license server...'
  #  trigger.run_remote = {path: 'vagrant/testing/restart-license-server.sh'}
  #end

  #instance.trigger.before [:suspend, :reload, :halt, :destroy] do |trigger|
  #  trigger.on_error = :continue
  #  trigger.info = 'Deactivating license with the license server...'
  #  trigger.run_remote = {path: 'vagrant/testing/deactivate-license-server.sh'}
  #end
end

# ssos_instance builds an instance definition for a distribution 
#
# The "plain" auth and "oldr" flavor are special and ends up provisioning
# an instance without a SSOS installation.
def ssos_instance(config, distribution, flavor, auth)
  ip = build_instance_ip(distribution, flavor, auth)
  name = build_instance_name(distribution, flavor, auth, '-')

  provisioners = []

  config.vm.define name, autostart: false do |instance|
    # SSOS_VERSION, and SSOS_IP environment variables.
    #
    # SSOS_VERSION is inherited from the existing environment.
    # SSOS_IP is defined as the IP used by this instance.
    #
    # The vagrant/testing/install-ssos-DISTRIBUTION.sh scripts require
    # SSOS_VERSION. Provisioning will fail if it is not set.
    env = {
      :SSOS_VERSION => SSOSVersion.new,
      :SSOS_IP => ip,
    }

    if distribution == "ssos"
      distribution = "ubuntu16"
      instance.vm.provider :virtualbox do |vb|
        vb.memory = ""
      end
    end

    # If we rely on default Vagrant sizing, we may not be able to build some
    # packages (Rcpp). But be careful about not making things too big if you are
    # going to have multiple boxes running at the same time.
    instance.vm.provider 'virtualbox' do |v|
      v.customize ['modifyvm', :id, '--cpus', '2']
      v.customize ['modifyvm', :id, '--memory', '2048']
    end

    provisioners.push(Installers['plain'][distribution])
    provisioners.push(Installers[flavor][distribution])

    setup_ssos_triggers(instance)

    box = Boxes[distribution]

    provisioners.flatten! # remove hierarchy
    provisioners.compact! # remove nil

    instance.vm.box = box
    instance.vm.hostname = name

    provision_ssos instance, ip, env, provisioners
  end
end

def provision_instances(provisioner)
  provisioner.call('ubuntu18', 'latest', 'plain')

  provisioner.call('ubuntu16', 'latest', 'plain')
  provisioner.call('ubuntu16', 'oldr',   '')

  provisioner.call('fedora28', 'latest', 'plain')

  provisioner.call('centos7', 'latest', 'plain')
  provisioner.call('centos7', 'oldr', '')

  provisioner.call('centos6', 'latest', 'plain')

  provisioner.call('opensuse42', 'latest', 'plain')
  provisioner.call('opensuse42', 'oldr', '')

  provisioner.call('opensuse15', 'latest', 'plain')
  provisioner.call('opensuse15', 'oldr', '')

  provisioner.call('ssos', 'latest', 'demos')
  #provisioner.call('license', 'server', '')
end

def provision_vagrant()
  Vagrant.configure(VAGRANTFILE_API_VERSION) do |config|
    vagrant_provisioner = Proc.new do |distribution, flavor, auth|
      ssos_instance(config, distribution, flavor, auth)
    end
    provision_instances(vagrant_provisioner)

    # Promote some of our local configuration to the vagrant instance.
    ['.tmux.conf', '.bash_aliases'].each do |f|
      source = File.expand_path('~/' + f)
      if File.exist?(source)
        config.vm.provision :file, source: source, destination: f, run: 'always'
      end
    end

    # If true, then any SSH sessions made will enable agent forwarding.
    # Default value: false
    #
    # RStudio: We forward the SSH agent to allow github sessions without copying keyfiles around.
    config.ssh.forward_agent = true
  end
end

def provision_hosts()
  hosts_provisioner = Proc.new do |distribution, flavor, auth|
    ip = build_instance_ip(distribution, flavor, auth)
    puts ip + "\t" + build_instance_name(distribution, flavor, auth, '.')
  end
  provision_instances(hosts_provisioner)
end

OSNames = {
  'ubuntu16' => 'Ubuntu 16.04',
  'ubuntu18' => 'Ubuntu 18.04',
  'centos6' => 'CentOS 6',
  'centos7' => 'CentOS 7',
  'fedora28' => 'Fedora 28',
  'opensuse42' => 'openSUSE 42.3',
  'opensuse15' => 'openSUSE 15.0',
  'license' => 'License Server (Ubuntu 18.04)',
  'rsc' => 'SSOS Demos (Ubuntu 16.04)',
}

SchemeNames = {
  'plain' => 'Plain',
  'oldr' => 'Old R',
}

FlavorNames = {
  'oldr' => 'Old R',
  '' => '',
}

def provision_docs()
  last_dist = [""]
  last_flavor = [""]
  docs_provisioner = Proc.new do |distribution, flavor, auth|
    if last_dist != distribution
      last_dist = distribution
      os = OSNames[distribution]
      puts "\n#### <a name=\"#{distribution}\"></a>#{os} VMs"
    end
    if last_flavor != flavor
      last_flavor = flavor
      label = FlavorNames[flavor]
      if flavor != "" && distribution != "license"
        puts "\n##### #{label}"
      end
      puts "\n"
    end
    ip = build_instance_ip(distribution, flavor, auth)
    instance = build_instance_name(distribution, flavor, auth, '-')
    hostname = build_instance_name(distribution, flavor, auth, '.')
    puts "* `#{instance}`: http://#{ip}:3939 or http://#{hostname}:3939"
  end
  provision_instances(docs_provisioner)
end

# Avoid using the Vagrant namespace when run as ./Vagrantfile or "ruby Vagrantfile".
if not "#{$PROGRAM_NAME}".end_with? "Vagrantfile"
  provision_vagrant()
elsif ARGV.length > 0
  if ARGV[0] == "oses"
    puts "| OS | Octet |"
    puts "| -- | ----- |"
    OSOctet.each do|key, value|
      os = OSNames[key]
      puts "|#{os}|#{value}|"
    end
  elsif ARGV[0] == "schemes"
    puts "| Scheme | Octet |"
    puts "| -- | ----- |"
    SchemeOctet.each do|key, value|
      scheme = SchemeNames[key]
      puts "|#{scheme}|#{value}|"
    end
  elsif ARGV[0] == "docs"
    provision_docs()
  elsif ARGV[0] == "hosts"
    provision_hosts()
  end
else
  puts "When not running under Vagrant this command accepts the following flags:"
  puts "- hosts - generate the content for the /etc/hosts with each IP/hostname for the VMs"
  puts "- docs - generate the markdown with the list of VMs for README.md"
  puts "- oses - generate the markdown with the list of IP sections for each OS for README.md"
  puts "- schemes - generate the markdown with the list of IP sections for each Scheme for README.md"
end

