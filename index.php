<?php
  require_once 'config/config.php';
  $appName = 'Prince of Persia';
  $appDescription = 'Faithful browser remake of Prince of Persia (Jordan Mechner, Broderbund, DOS 1990) on the svision library: VGA 320x200 in 256 colours, the original data, the original physics.';
  $appPrefix = 'pop';
  $appNoscript =
    '<h1>'.$appName.'</h1>'.
    '<p>Prince of Persia is the 1989 platform game by Jordan Mechner: one hour to cross the dungeons and the '.
    'palace of the Grand Vizier Jaffar and reach the Princess. This is a faithful remake of the DOS version that runs '.
    'in your web browser. Please enable JavaScript to start the game.</p>';
  require_once 'app/svision/php/main.php';
