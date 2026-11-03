extends Node

@export var stream: AudioStream

@onready var player: AudioStreamPlayer = $AudioStreamPlayer

func _ready() -> void:
	if stream:
		player.stream = stream
		player.play()
