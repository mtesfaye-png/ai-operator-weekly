// Prints "1" if any audio input device (microphone) is being used by any app right now, else "0".
// A call in Zoom, Meet, Teams, FaceTime, Slack huddles etc. keeps the microphone running. No permissions needed:
// this only asks Core Audio whether a device is running, it never opens or records from it.
import CoreAudio

func prop<T>(_ id: AudioObjectID, _ sel: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal, _ value: inout T) -> Bool {
  var addr = AudioObjectPropertyAddress(mSelector: sel, mScope: scope, mElement: kAudioObjectPropertyElementMain)
  var size = UInt32(MemoryLayout<T>.size)
  return AudioObjectGetPropertyData(id, &addr, 0, nil, &size, &value) == noErr
}

var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
var size: UInt32 = 0
AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size)
var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &ids)

var inUse = false
for id in ids {
  // Input devices only: they have at least one input stream.
  var saddr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreams, mScope: kAudioDevicePropertyScopeInput, mElement: kAudioObjectPropertyElementMain)
  var ssize: UInt32 = 0
  if AudioObjectGetPropertyDataSize(id, &saddr, 0, nil, &ssize) != noErr || ssize == 0 { continue }
  var running: UInt32 = 0
  if prop(id, kAudioDevicePropertyDeviceIsRunningSomewhere, kAudioObjectPropertyScopeGlobal, &running), running != 0 { inUse = true; break }
}
print(inUse ? "1" : "0")
